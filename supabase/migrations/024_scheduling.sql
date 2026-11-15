-- ============================================================================
-- 024 — Scheduling
-- ============================================================================
--
-- `tasks.scheduled_date` has been in the schema since 001 with a
-- `DEFAULT CURRENT_DATE`, and until this migration **nothing read it**. The
-- importer stamped every row with the day it arrived; every screen ignored the
-- column. The only schedule the app could express was "now".
--
-- The department sheets have no planned-date column (only `DateIn` and
-- `DateOut`), so a date cannot be imported. It is set by the supervisor, or it
-- defaults to the arrival day — which is what already happens.
--
-- What changes here:
--
--   1. an index, so ordering and filtering by day is not a sequential scan;
--   2. `list_open_tasks` returns work in the order it is **due** rather than the
--      order it was reported. For every job that exists today these two orders
--      are the same, because `scheduled_date` is the arrival day;
--   3. `task_work_logs.action` gains `scheduled`, so a moved job leaves a line
--      in its own audit trail;
--   4. `set_task_schedule` — the one way to move a job to another day. New, so
--      it cannot break an existing caller.
--
-- Nothing is deleted, no row is updated, and no existing function changes
-- behaviour for a job whose date is today or in the past.
--
-- Rollback is at the bottom.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The index
-- ----------------------------------------------------------------------------
-- `list_open_tasks` is called on every board load and is capped at 600 rows.
-- Ordering by a day column is only cheap with an index behind it, and the
-- composite starts with the column every query filters on first.
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled
  ON public.tasks (group_id, scheduled_date);


-- ----------------------------------------------------------------------------
-- 2. list_open_tasks — due order
-- ----------------------------------------------------------------------------
-- Only the ORDER BY changes. The guard, the status filter and the 600-row cap
-- are copied unchanged from 011 — `OPEN_TASK_CAP` in the client and its test
-- both depend on that limit staying put.
--
-- Why `scheduled_date` first: a job planned for tomorrow should not jump ahead
-- of one that was due last week. Reported-date order was a proxy for due order
-- and is now the tie-break.
--
-- `NULLS LAST` on the day, because a row with no date (possible only through a
-- hand-written insert; the column is NOT NULL) should not sort to the top.
CREATE OR REPLACE FUNCTION public.list_open_tasks(p_token uuid, p_group_id uuid)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN QUERY
    SELECT t.* FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    ORDER BY
      t.scheduled_date ASC NULLS LAST,
      t.reported_date ASC NULLS LAST,
      t.created_at ASC
    LIMIT 600;
END;
$$;

-- CREATE OR REPLACE keeps existing grants, but re-stating them costs nothing and
-- makes this file self-contained if it is ever replayed into a fresh project.
GRANT EXECUTE ON FUNCTION public.list_open_tasks(uuid, uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. The visit log learns one word
-- ----------------------------------------------------------------------------
-- `task_work_logs.action` is a CHECK allow-list, last set in 008. A reschedule
-- needs a line in the audit trail, and 'scheduled' is not on the list — so
-- `set_task_schedule` below would fail at run time with a check violation on a
-- live job, not at compile time.
--
-- Widening an allow-list is backwards-compatible: every existing row still
-- satisfies it, and no row is touched. The guard mirrors 008 so this file can
-- be replayed against a project whose constraint is already wider.
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
      'scheduled'
    ));
END;
$do$;


-- ----------------------------------------------------------------------------
-- 3. set_task_schedule — the one way to move a job to another day
-- ----------------------------------------------------------------------------
-- Deliberately small. `create_manual_task` is ~200 lines and already inserts
-- `scheduled_date = CURRENT_DATE`; rewriting it to accept a date from the
-- payload would mean re-pasting the whole body, and a mistake inside a
-- SECURITY DEFINER function fails quietly. A new three-column UPDATE next to it
-- is a far smaller thing to get right.
--
-- Bounds are generous on purpose: the client checks the real planning window
-- (±90 days), and this only rejects values that are certainly a typo — a year
-- before 2000, or more than a decade ahead. Rejecting tightly here would mean a
-- phone with a skewed clock cannot record work at all.
CREATE OR REPLACE FUNCTION public.set_task_schedule(
  p_token uuid,
  p_task_id uuid,
  p_day date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_before date;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role NOT IN ('supervisor', 'manager') THEN
    RAISE EXCEPTION 'Only a supervisor can plan a job';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND group_id = v_caller.group_id;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF p_day IS NULL THEN
    RAISE EXCEPTION 'A date is required';
  END IF;

  IF p_day < DATE '2000-01-01' OR p_day > CURRENT_DATE + 3650 THEN
    RAISE EXCEPTION 'That date is not believable';
  END IF;

  -- A closed job is history. Moving its date would rewrite the record of when
  -- the work happened, which is the one thing the reports rely on.
  IF v_task.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'A finished job keeps its date';
  END IF;

  v_before := v_task.scheduled_date;

  IF v_before = p_day THEN
    -- Nothing to do, and no log line: repeating the same date should not fill
    -- the audit trail of a job with noise.
    RETURN jsonb_build_object('ok', true, 'changed', false, 'task', to_jsonb(v_task));
  END IF;

  UPDATE public.tasks
  SET scheduled_date = p_day
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  -- The visit log is the audit trail shown on the job sheet. A date that moves
  -- without a line saying who moved it is exactly the kind of quiet change this
  -- app is supposed to avoid.
  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (
    v_task.id,
    v_caller.id,
    'scheduled',
    'Moved from ' || to_char(v_before, 'YYYY-MM-DD')
      || ' to ' || to_char(p_day, 'YYYY-MM-DD')
      || ' by ' || v_caller.full_name
  );

  RETURN jsonb_build_object('ok', true, 'changed', true, 'task', to_jsonb(v_task));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_task_schedule(uuid, uuid, date) TO anon, authenticated;


-- ============================================================================
-- Rollback
-- ============================================================================
--
--   DROP FUNCTION IF EXISTS public.set_task_schedule(uuid, uuid, date);
--   DROP INDEX IF EXISTS public.idx_tasks_scheduled;
--
--   -- Restoring the old action list means deleting any 'scheduled' log lines
--   -- first, so the check can be re-added:
--   --   DELETE FROM public.task_work_logs WHERE action = 'scheduled';
--   --   ALTER TABLE public.task_work_logs DROP CONSTRAINT task_work_logs_action_check;
--   --   ALTER TABLE public.task_work_logs ADD CONSTRAINT task_work_logs_action_check
--   --     CHECK (action IN ('imported','assigned','unassigned','started','paused',
--   --                      'blocked','resumed','completed','reopened','cancelled'));
--
--   -- then restore list_open_tasks from 011 (its ORDER BY line was
--   --   ORDER BY t.reported_date ASC NULLS LAST, t.created_at ASC)
--
-- `scheduled_date` values written by set_task_schedule are ordinary task rows;
-- dropping the function does not change them, and they read as "due" once the
-- client stops distinguishing planned jobs. No data is lost by rolling back.
-- ============================================================================
