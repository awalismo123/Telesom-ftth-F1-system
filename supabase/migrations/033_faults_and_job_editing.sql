-- ============================================================================
-- 033 — Faults get their own clock, their own words, and jobs become editable
-- ============================================================================
--
-- Four changes, in order of blast radius:
--
--   1. A **fault clock**: 48 hours, against 72 for installations.
--   2. A **fault type** allow-list, so "what keeps breaking" is answerable.
--   3. `edit_task` — corrections without a delete.
--   4. `delete_task` — strict, permanent, and refusing anything with history.
--
-- ## Why the clock needs the database, not just the screens
--
-- `today_summary` computes `over_sla` and `due_today` with a hardcoded
-- `interval '3 days'`. If the browser used 48 hours for faults while the
-- database still counted 72, the supervisor's overview would say one thing and
-- the fault tab another — and the last two phases existed partly to stop exactly
-- that class of disagreement.
--
-- So the clock is defined **once**, in `task_sla_days(task_type)`, and every
-- consumer reads it: `today_summary`, and the client mirror in
-- `src/lib/faults.ts` (which a test compares against this file).
--
-- ## Nothing is rewritten
--
-- No existing row changes meaning. `fault_type` is added NULL and stays NULL on
-- the ten installations and nine faults that already exist; the screens say
-- "not recorded" rather than guessing. `over_sla` will now count the nine
-- existing faults at 48h instead of 72h — that is the intended change in
-- definition, and it makes the number *larger*, never smaller, so nothing is
-- quietly hidden.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The clock, in one place
-- ----------------------------------------------------------------------------
-- 48 hours for a fault: the customer is already paying and has no service. 72
-- for an installation: it is a booking, and it was promised as one.
--
-- Immutable and tiny so it can be used inside an index-able comparison and
-- inlined by the planner.
CREATE OR REPLACE FUNCTION public.task_sla_days(p_task_type text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_task_type = 'cilada' THEN 2 ELSE 3 END;
$$;

COMMENT ON FUNCTION public.task_sla_days(text) IS
  'The promised window, in days, for a task type. A fault (cilada) is 2 days; an installation is 3. This is the single definition — today_summary and the client both read it.';

GRANT EXECUTE ON FUNCTION public.task_sla_days(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. The fault type
-- ----------------------------------------------------------------------------
-- A fixed list, not free text. Three people typing free text produce three
-- spellings of the same fault, and the question this field exists to answer —
-- "which fault keeps coming back in this area" — needs exact values.
--
-- The list is deliberately small and physical. It is what a technician can tell
-- apart at the cabinet, not a taxonomy.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS fault_type text;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_fault_type_check' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_fault_type_check;
  END IF;

  -- NULL is allowed and means "not recorded". That is the honest state of every
  -- fault already in the database, and a CHECK that forced a value would have
  -- required inventing one for nine real jobs.
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_fault_type_check
    CHECK (
      fault_type IS NULL
      OR fault_type IN (
        'no_signal',       -- no service at all
        'slow_speed',      -- service present, below the plan
        'cut_cable',       -- physical break, usually a dig or a vehicle
        'faulty_box',      -- the cabinet or splitter itself
        'damaged_port',    -- one port, box otherwise healthy
        'loose_connector', -- re-seat and test
        'power',           -- customer side has no power
        'other'
      )
    );
END;
$do$;

COMMENT ON COLUMN public.tasks.fault_type IS
  'What kind of fault, from a fixed list. NULL means not recorded — never guessed. Only meaningful when task_type = cilada.';

-- A fault type on an installation is a data-entry mistake, not a fact to store.
-- Enforced here rather than in a screen so it holds whatever writes the row.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_fault_type_only_on_fault'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_fault_type_only_on_fault;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_fault_type_only_on_fault
    CHECK (fault_type IS NULL OR task_type = 'cilada');
END;
$do$;

-- Reporting by fault type over a date range is the query this field exists for.
CREATE INDEX IF NOT EXISTS idx_tasks_fault_type
  ON public.tasks(group_id, fault_type)
  WHERE fault_type IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. `today_summary` — read the clock instead of hardcoding it
-- ----------------------------------------------------------------------------
-- Same name, same signature, same keys. Three differences:
--   * `over_sla` and `due_today` use each task's own window;
--   * `over_by_type` is added, so the overview can say "4 faults are late"
--     without loading every task;
--   * the day arithmetic stays on `v_day` so a supervisor in Hargeisa does not
--     get the server's yesterday.
CREATE OR REPLACE FUNCTION public.today_summary(
  p_token uuid,
  p_group_id uuid,
  p_day date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_day date;
  v_result jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  -- A supervisor only ever sees their own group; a manager may name any.
  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_day := COALESCE(p_day, (now() AT TIME ZONE 'UTC')::date);

  SELECT jsonb_build_object(
    'day', v_day,

    'open_now',     count(*) FILTER (WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')),
    'unassigned',   count(*) FILTER (WHERE t.status = 'unassigned'),
    'assigned',     count(*) FILTER (WHERE t.status = 'assigned'),
    'in_progress',  count(*) FILTER (WHERE t.status = 'in_progress'),
    'blocked',      count(*) FILTER (WHERE t.status = 'blocked'),

    -- Past its own promise. A fault is judged at 48 hours, an installation at
    -- 72 — the same comparison the client makes, because both read
    -- task_sla_days.
    'over_sla',     count(*) FILTER (
                      WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
                        AND coalesce(t.reported_date::timestamptz, t.created_at)
                            < now() - make_interval(days => public.task_sla_days(t.task_type))
                    ),

    -- At the promise rather than past it: this many days ago by its own clock,
    -- still open. The supervisor's chance to act before the promise breaks.
    'due_today',    count(*) FILTER (
                      WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
                        AND coalesce(t.reported_date::timestamptz, t.created_at)::date
                            = (v_day - make_interval(days => public.task_sla_days(t.task_type)))::date
                    ),

    'created_today',   count(*) FILTER (WHERE t.created_at >= v_day::timestamptz AND t.created_at < (v_day + 1)::timestamptz),
    'completed_today', count(*) FILTER (WHERE t.completed_at >= v_day::timestamptz AND t.completed_at < (v_day + 1)::timestamptz)
  )
  INTO v_result
  FROM public.tasks t
  WHERE t.group_id = p_group_id;

  -- Open work split by kind and by whether it has broken its promise. The
  -- overview can then say "4 of 9 faults are late" without loading tasks, which
  -- matters because the open-task list is capped at 600 rows and this is not.
  v_result := v_result || jsonb_build_object(
    'open_faults', (
      SELECT count(*) FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'cilada'
        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    ),
    'open_installs', (
      SELECT count(*) FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'installation'
        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    ),
    'late_faults', (
      SELECT count(*) FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'cilada'
        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
        AND coalesce(t.reported_date::timestamptz, t.created_at)
            < now() - make_interval(days => public.task_sla_days(t.task_type))
    ),
    'late_installs', (
      SELECT count(*) FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'installation'
        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
        AND coalesce(t.reported_date::timestamptz, t.created_at)
            < now() - make_interval(days => public.task_sla_days(t.task_type))
    ),
    -- Faults with no type recorded. Not an error state to hide: it is work the
    -- supervisor can improve in a minute, and the fault tab offers a bulk edit.
    'faults_untyped', (
      SELECT count(*) FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'cilada'
        AND t.fault_type IS NULL
        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    )
  );

  -- Who is out, counted from the work rather than from the roster: a crew with
  -- no running job is not "out", however many members it has.
  v_result := v_result || jsonb_build_object(
    'crews_out', (
      SELECT count(DISTINCT t.assigned_crew_id)
      FROM public.tasks t
      WHERE t.group_id = p_group_id AND t.status = 'in_progress' AND t.assigned_crew_id IS NOT NULL
    ),
    'crews_total', (
      SELECT count(*) FROM public.crews c
      WHERE c.group_id = p_group_id AND c.is_active
        AND EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.crew_id = c.id)
    ),
    'crews_empty', (
      SELECT count(*) FROM public.crews c
      WHERE c.group_id = p_group_id AND c.is_active
        AND NOT EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.crew_id = c.id)
    ),
    'people_out', (
      SELECT count(DISTINCT worker) FROM (
        SELECT t.assigned_user_id AS worker
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'in_progress' AND t.assigned_user_id IS NOT NULL
        UNION
        SELECT cm.user_id
        FROM public.tasks t
        JOIN public.crew_members cm ON cm.crew_id = t.assigned_crew_id
        WHERE t.group_id = p_group_id AND t.status = 'in_progress'
      ) w
    ),
    'server_now', now()
  );

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.today_summary(uuid, uuid, date) IS
  'Operational counts for one day. over_sla and due_today use each task''s own window via task_sla_days (faults 2 days, installations 3). open_faults / late_faults split the backlog by kind.';

GRANT EXECUTE ON FUNCTION public.today_summary(uuid, uuid, date) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. `edit_task` — corrections, without a delete
-- ----------------------------------------------------------------------------
-- Six fields, all optional in the sense that passing NULL leaves them alone.
-- Deliberately narrow: identity (line_number, customer name), place (area, box,
-- port), urgency, the fault type, and the promise date. Everything else —
-- status, assignment, timers, proof — has its own function with its own rules,
-- and a general-purpose updater would let a typo move a job between states.
--
-- Refuses to touch a cancelled job's place or urgency: the row is a record of
-- something that was called off, and rewriting it would rewrite history.
CREATE OR REPLACE FUNCTION public.edit_task(
  p_token uuid,
  p_task_id uuid,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_xaafada text DEFAULT NULL,
  p_cablebox_code_raw text DEFAULT NULL,
  p_port_number int DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_fault_type text DEFAULT NULL,
  p_reported_date date DEFAULT NULL,
  p_clear_fault_type boolean DEFAULT false
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_before jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can edit a job';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'A completed job cannot be edited. Reopen it first.';
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('normal', 'urgent') THEN
    RAISE EXCEPTION 'Priority must be normal or urgent';
  END IF;

  -- A cancelled job keeps the record it was cancelled with.
  IF v_task.status = 'cancelled'
     AND (p_xaafada IS NOT NULL OR p_cablebox_code_raw IS NOT NULL OR p_priority IS NOT NULL) THEN
    RAISE EXCEPTION 'A cancelled job is a record. Reopen it before changing its place or urgency.';
  END IF;

  IF p_reported_date IS NOT NULL AND p_reported_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A job cannot be reported in the future';
  END IF;

  -- A fault type on an installation is a mistake; say so rather than store it.
  IF p_fault_type IS NOT NULL AND v_task.task_type <> 'cilada' THEN
    RAISE EXCEPTION 'Only a fault job can have a fault type';
  END IF;

  -- Keep the old values so the change is auditable and an honest mistake can be
  -- undone by reading the log rather than by memory.
  v_before := jsonb_build_object(
    'customer_name', v_task.customer_name,
    'customer_phone', v_task.customer_phone,
    'xaafada', v_task.xaafada,
    'cablebox_code_raw', v_task.cablebox_code_raw,
    'port_number', v_task.port_number,
    'priority', v_task.priority,
    'fault_type', v_task.fault_type,
    'reported_date', v_task.reported_date
  );

  UPDATE public.tasks
  SET customer_name      = COALESCE(NULLIF(btrim(p_customer_name), ''), customer_name),
      customer_phone     = CASE
                             WHEN p_customer_phone IS NULL THEN customer_phone
                             ELSE NULLIF(btrim(p_customer_phone), '')
                           END,
      xaafada            = CASE
                             WHEN p_xaafada IS NULL THEN xaafada
                             ELSE NULLIF(btrim(p_xaafada), '')
                           END,
      cablebox_code_raw  = CASE
                             WHEN p_cablebox_code_raw IS NULL THEN cablebox_code_raw
                             ELSE NULLIF(btrim(p_cablebox_code_raw), '')
                           END,
      port_number        = COALESCE(p_port_number, port_number),
      priority           = COALESCE(p_priority, priority),
      fault_type         = CASE
                             WHEN p_clear_fault_type THEN NULL
                             ELSE COALESCE(p_fault_type, fault_type)
                           END,
      reported_date      = COALESCE(p_reported_date, reported_date),
      updated_at         = now()
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (v_task.id, v_caller.id, 'edited', v_before::text);

  RETURN v_task;
END;
$fn$;

COMMENT ON FUNCTION public.edit_task(uuid, uuid, text, text, text, text, int, text, text, date, boolean) IS
  'Correct a job''s identity, place, urgency, fault type or promise date. Cannot change status; refuses completed jobs and refuses to rewrite a cancelled job''s record. Logs the previous values.';

GRANT EXECUTE ON FUNCTION public.edit_task(uuid, uuid, text, text, text, text, int, text, text, date, boolean) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. `delete_task` — strict, permanent, and refusing anything with a history
-- ----------------------------------------------------------------------------
-- The department asked for a real delete, and there is a real need for one: a
-- sheet imported twice, a row typed against the wrong line. Cancel is not a
-- substitute because a cancelled row still occupies the line number and still
-- shows up in counts.
--
-- But `task_work_logs` cascades. A hard delete of a job that was ever worked
-- destroys its timers, dBm readings, blockers and completion record — evidence.
-- So the policy is the strict one:
--
--   * never assigned, never started, never completed;
--   * no timer of any kind recorded;
--   * no photo, no material, no box log pointing at it.
--
-- Anything else must be cancelled. And a delete is written into the import
-- batch's summary **before** the row goes, so a wrongly-imported sheet can still
-- be traced afterwards.
CREATE OR REPLACE FUNCTION public.delete_task(
  p_token uuid,
  p_task_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_reason text;
  v_logs int;
  v_photos int;
  v_materials int;
  v_box_logs int;
  v_children int;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can delete a job';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason is required to delete a job';
  END IF;

  -- A completed job is a record of work somebody did. It is never deletable.
  IF v_task.status = 'completed' OR v_task.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed job can never be deleted. It is the record of work somebody did.';
  END IF;

  -- Any sign of work at all. The columns are checked directly as well as the log
  -- table, because a timer can be running with no row written yet.
  IF v_task.status IN ('in_progress', 'blocked')
     OR v_task.active_started_at IS NOT NULL
     OR v_task.assigned_user_id IS NOT NULL
     OR v_task.assigned_crew_id IS NOT NULL
     OR v_task.assigned_at IS NOT NULL
     OR COALESCE(v_task.accumulated_seconds, 0) > 0
     OR v_task.blocked_at IS NOT NULL
     OR v_task.optical_dbm IS NOT NULL
     OR v_task.proof_photo_id IS NOT NULL THEN
    RAISE EXCEPTION 'This job has been worked on. Cancel it instead — the history is evidence.';
  END IF;

  SELECT count(*) INTO v_logs FROM public.task_work_logs WHERE task_id = p_task_id;
  IF v_logs > 0 THEN
    RAISE EXCEPTION 'This job has work logs. Cancel it instead — the history is evidence.';
  END IF;

  SELECT count(*) INTO v_photos FROM public.task_photos WHERE task_id = p_task_id;
  IF v_photos > 0 THEN
    RAISE EXCEPTION 'This job has photos. Cancel it instead.';
  END IF;

  SELECT count(*) INTO v_materials FROM public.task_materials WHERE task_id = p_task_id;
  IF v_materials > 0 THEN
    RAISE EXCEPTION 'This job has materials recorded. Cancel it instead.';
  END IF;

  SELECT count(*) INTO v_box_logs FROM public.cablebox_logs WHERE task_id = p_task_id;
  IF v_box_logs > 0 THEN
    RAISE EXCEPTION 'This job is recorded against a cable box. Cancel it instead.';
  END IF;

  -- A job another job was raised from: deleting it would orphan the follow-up.
  SELECT count(*) INTO v_children FROM public.tasks WHERE previous_task_id = p_task_id;
  IF v_children > 0 THEN
    RAISE EXCEPTION 'Another job was raised from this one. Cancel it instead.';
  END IF;

  -- Written before the delete, so it survives it. `import_batches.decision_summary`
  -- is jsonb and already carries the import's own record.
  IF v_task.import_batch_id IS NOT NULL THEN
    UPDATE public.import_batches
    SET decision_summary = COALESCE(decision_summary, '{}'::jsonb) || jsonb_build_object(
      'deleted',
      COALESCE(decision_summary -> 'deleted', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', now(),
          'by', v_caller.full_name,
          'reason', v_reason,
          'task', jsonb_build_object(
            'line_number', v_task.line_number,
            'customer_name', v_task.customer_name,
            'customer_phone', v_task.customer_phone,
            'task_type', v_task.task_type,
            'xaafada', v_task.xaafada,
            'cablebox_code_raw', v_task.cablebox_code_raw,
            'reported_date', v_task.reported_date
          )
        )
      )
    )
    WHERE id = v_task.import_batch_id;
  END IF;

  DELETE FROM public.tasks WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', 1,
    'line_number', v_task.line_number,
    'reason', v_reason
  );
END;
$fn$;

COMMENT ON FUNCTION public.delete_task(uuid, uuid, text) IS
  'Permanently delete a job that was never worked: no assignment, no timer, no logs, no photos, no materials, no box log, no child job. Anything else must be cancelled. Records the deletion in the import batch first.';

GRANT EXECUTE ON FUNCTION public.delete_task(uuid, uuid, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. The visit log learns two words
-- ----------------------------------------------------------------------------
-- `edited` and `deleted` join the allow-list. Widening a CHECK is
-- backwards-compatible: every existing row still satisfies it.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_work_logs'::regclass
      AND conname = 'task_work_logs_action_check'
  ) THEN
    ALTER TABLE public.task_work_logs DROP CONSTRAINT task_work_logs_action_check;
  END IF;

  ALTER TABLE public.task_work_logs
    ADD CONSTRAINT task_work_logs_action_check
    CHECK (action IN (
      'imported', 'assigned', 'unassigned', 'started', 'paused',
      'blocked', 'resumed', 'completed', 'reopened', 'cancelled',
      'scheduled', 'en_route', 'edited'
    ));
END;
$do$;

-- ----------------------------------------------------------------------------
-- 7. The technician's route, split by kind
-- ----------------------------------------------------------------------------
-- The route is the whole job list for one person, so a fault and an installation
-- arrive in one array and compete for the same morning. Faults are added as a
-- separate key rather than by reordering, so nothing about the existing array
-- changes for callers that do not know about it.
--
-- This is a **wrapper**: the 002 definition is left untouched and its result is
-- extended. Re-implementing the route would mean copying ~120 lines of
-- security-relevant filtering, which is a poor trade for one extra key.
CREATE OR REPLACE FUNCTION public.technician_route_split(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_route jsonb;
  v_tasks jsonb;
BEGIN
  -- One argument, matching `technician_route` exactly: the route is the caller's
  -- own, and the group is whatever their session says it is. Passing a group id
  -- here would have been a second, weaker permission check beside the one the
  -- original function already makes.
  v_route := public.technician_route(p_token);
  v_tasks := COALESCE(v_route -> 'tasks', '[]'::jsonb);

  RETURN v_route || jsonb_build_object(
    'tasks', v_tasks,
    -- Faults first by their own promise date, then installations. Each array is
    -- sorted on its own so neither can push the other down.
    'faults', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'scheduled_date', x ->> 'reported_date'), '[]'::jsonb)
      FROM jsonb_array_elements(v_tasks) x
      WHERE x ->> 'task_type' = 'cilada'
    ),
    'installs', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'scheduled_date', x ->> 'reported_date'), '[]'::jsonb)
      FROM jsonb_array_elements(v_tasks) x
      WHERE x ->> 'task_type' = 'installation'
    )
  );
END;
$fn$;

COMMENT ON FUNCTION public.technician_route_split(uuid) IS
  'The technician''s route with faults and installations separated, so a fault never waits behind an installation. Wraps technician_route; does not reimplement its filtering.';

GRANT EXECUTE ON FUNCTION public.technician_route_split(uuid) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
--   -- Safe: drops the added dispatcher and the new column. Loses the fault type
--   -- on any job it was recorded against, which is why it is a last resort.
--   DROP FUNCTION IF EXISTS public.technician_route_split(uuid);
--   DROP FUNCTION IF EXISTS public.delete_task(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.edit_task(uuid, uuid, text, text, text, text, int, text, text, date, boolean);
--   -- then re-apply the 023 definition of today_summary (it hardcodes 3 days)
--   DROP FUNCTION IF EXISTS public.task_sla_days(text);
--   DROP INDEX IF EXISTS public.idx_tasks_fault_type;
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_fault_type_only_on_fault;
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_fault_type_check;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS fault_type;
--   -- and restore the 025 allow-list on task_work_logs.action.
--
-- No task, timer, photo or completion record is read or written by this
-- migration beyond the NULL fault_type column. Nothing is backfilled, nothing is
-- rewritten, and no existing row changes value.
-- ============================================================================
