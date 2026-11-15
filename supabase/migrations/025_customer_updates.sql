-- ============================================================================
-- 025 — Customer updates: "on my way"
-- ============================================================================
--
-- Two things a customer waiting at home needs to know: that someone is coming,
-- and which day. The app has never told them either. The supervisor could copy
-- the dispatch plan and paste it into WhatsApp by hand, but a per-job message
-- meant retyping the customer's name, line and day every time.
--
-- This migration adds the smallest thing that makes it work:
--
--   1. `tasks.en_route_at` — one nullable timestamp. Null means "no claim has
--      been made", which is why it must not default to now();
--   2. `mark_en_route` — a technician (or their partner, or a supervisor acting
--      for them) stamps that time once;
--   3. a trigger that clears the stamp when a job is reassigned, because a
--      journey that has not happened cannot be "since 09:41";
--   4. `task_work_logs.action` widened to accept 'en_route'.
--
-- **Nothing here sends anything.** The message text is built in the browser
-- (`src/lib/customerUpdate.ts`) and handed to the phone's WhatsApp via a
-- `wa.me` link with no recipient in it, so WhatsApp opens its own contact
-- picker and a person still has to press send. There is no server-side send, no
-- API key, and no cost.
--
-- Rollback is at the bottom. It drops a column that no migration before this
-- one references.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The stamp
-- ----------------------------------------------------------------------------
-- Nullable and with **no default**. A default of now() would mean every job in
-- the table claims a technician is already travelling to it.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS en_route_at timestamptz;


-- ----------------------------------------------------------------------------
-- 2. A journey belongs to a person, not to a job
-- ----------------------------------------------------------------------------
-- If a job moves from Cabdi to Maxamed, the stamp belongs to Cabdi's drive. Left
-- in place it would tell a supervisor — and the job sheet — that someone has
-- been travelling since 09:41 when nobody has left.
--
-- A trigger rather than an edit to `assign_tasks` / `unassign_tasks`: those are
-- long SECURITY DEFINER functions, and re-pasting one to add a column reset is
-- how a working function quietly stops working. This touches nothing except the
-- brand-new column.
CREATE OR REPLACE FUNCTION public.clear_en_route_on_reassign()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
     OR NEW.assigned_crew_id IS DISTINCT FROM OLD.assigned_crew_id THEN
    NEW.en_route_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_clear_en_route ON public.tasks;
CREATE TRIGGER trg_clear_en_route
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_en_route_on_reassign();


-- ----------------------------------------------------------------------------
-- 3. The visit log learns one more word
-- ----------------------------------------------------------------------------
-- Same constraint `024` widened for 'scheduled'. Adding a word here means the
-- audit line below cannot fail a CHECK at run time — which is exactly how this
-- would have broken if the list had been left alone.
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
      'scheduled', 'en_route'
    ));
END;
$do$;


-- ----------------------------------------------------------------------------
-- 4. mark_en_route
-- ----------------------------------------------------------------------------
-- Idempotent in the direction that matters: pressing the button twice keeps the
-- **first** timestamp. That is when the journey actually began; re-stamping on
-- every tap would make a 40-minute drive look like it started at the last tap.
--
-- Permission reuses `is_task_worker` — the existing definition of "who may act
-- on this job" (assigned technician, member of the assigned crew, or a
-- supervisor). A crew job is worked from one phone between two people, and a
-- supervisor relaying "he has left" is the same act.
CREATE OR REPLACE FUNCTION public.mark_en_route(p_token uuid, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  IF v_task.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'This job is already finished';
  END IF;

  -- Already travelling. Return what was recorded rather than moving the clock.
  IF v_task.en_route_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_marked', true,
      'en_route_at', v_task.en_route_at,
      'task', to_jsonb(v_task)
    );
  END IF;

  UPDATE public.tasks
  SET en_route_at = now(),
      updated_at = now()
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (v_task.id, v_caller.id, 'en_route', 'Told the customer a technician is on the way');

  RETURN jsonb_build_object(
    'ok', true,
    'already_marked', false,
    'en_route_at', v_task.en_route_at,
    'task', to_jsonb(v_task)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_en_route(uuid, uuid) TO anon, authenticated;


-- ============================================================================
-- Rollback
-- ============================================================================
--
--   DROP FUNCTION IF EXISTS public.mark_en_route(uuid, uuid);
--   DROP TRIGGER IF EXISTS trg_clear_en_route ON public.tasks;
--   DROP FUNCTION IF EXISTS public.clear_en_route_on_reassign();
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS en_route_at;
--
--   -- The action allow-list: removing 'en_route' again requires deleting the
--   -- rows that use it, or the CHECK cannot be re-added.
--   --   DELETE FROM public.task_work_logs WHERE action = 'en_route';
--   --   ...then re-add the constraint without 'en_route'.
--
-- Dropping the column loses only when a technician said "on the way" — a fact
-- with no reporting dependency and no other column derived from it. Job
-- statuses, durations, dBm readings and completion times are untouched.
-- ============================================================================
