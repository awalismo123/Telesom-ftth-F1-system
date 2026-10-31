-- ============================================================================
-- Migration 008 — Batch E (1/2): a cancelled job is a real state
--
--   * tasks gains status 'cancelled' with who / when / why, a source column
--     (sheet or manual) and a reopen counter.
--   * the work log learns 'cancelled'.
--   * a trigger makes 'cancelled' final: assign / start / block / complete all
--     refuse to resurrect it. Only reopen_task (migration 009) may.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cancelled lifecycle + manual intake audit
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reopened_count int NOT NULL DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS last_reopened_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sheet';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS intake_notes text;

DO $$
BEGIN
  -- status: add 'cancelled'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_status_check' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_status_check;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('unassigned', 'assigned', 'in_progress', 'blocked', 'completed', 'cancelled'));

  -- where the job came from: a daily sheet, or a person typing it in
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_source_check' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_source_check;
  END IF;

  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_source_check
    CHECK (source IN ('sheet', 'manual'));

  -- work log: cancel is an event like any other
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_work_logs_action_check'
      AND conrelid = 'public.task_work_logs'::regclass
  ) THEN
    ALTER TABLE public.task_work_logs DROP CONSTRAINT task_work_logs_action_check;
  END IF;

  ALTER TABLE public.task_work_logs
    ADD CONSTRAINT task_work_logs_action_check
    CHECK (action IN (
      'imported', 'assigned', 'unassigned', 'started', 'paused',
      'blocked', 'resumed', 'completed', 'reopened', 'cancelled'
    ));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_open_group
  ON public.tasks(group_id, status) WHERE status IN ('unassigned', 'assigned', 'in_progress', 'blocked');

-- ----------------------------------------------------------------------------
-- 2. 'cancelled' is final — for everyone except reopen_task
--
-- assign_tasks, start_task, complete_task and unassign_tasks all guard against
-- 'completed' but know nothing about 'cancelled'. Rather than redefining four
-- functions (and any future one), the rule lives in the table: a cancelled job
-- cannot move to an active status unless the caller is reopen_task.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_guard_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF OLD.status = 'cancelled'
     AND NEW.status <> 'cancelled'
     AND COALESCE(current_setting('f1.allow_reopen', true), '') <> 'on' THEN
    RAISE EXCEPTION 'This job was cancelled. Reopen it before working on it again.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_guard_cancelled ON public.tasks;
CREATE TRIGGER tasks_guard_cancelled
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_guard_cancelled();
