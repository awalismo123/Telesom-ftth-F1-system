-- ============================================================================
-- 031 — Jobs reaching the promise today
-- ============================================================================
--
-- The group promises three days. Everything on the supervisor's screen measures
-- jobs that have **already** broken that promise — `waiting_over_sla`,
-- `over_sla`, the red `late` badge. Nothing measures a job that reaches the
-- deadline **today**, which is the only group of jobs where doing something now
-- still keeps the promise.
--
-- ## The rule, unchanged
--
-- `SLA_DAYS = 3` is not edited here and must not be. It is a promise made to
-- customers, it is pinned across five sites, and changing it without evidence
-- would change what the department owes people. This migration adds a view of
-- the deadline; it does not move it.
--
-- A job is **due** on the day it reaches three days and **late** the day after.
-- That matches `agingBand` in `src/lib/activity.ts` (`days === sla` → due,
-- `days > sla` → late) and `waiting_over_sla` in 013 (`< now() - interval
-- '3 days'`, strictly less, so exactly three days is not yet over).
--
-- ## Counted from the report date
--
-- `reported_date` is what the sheet says and what the customer counts from.
-- `created_at` is when we read the sheet, which can be a day later. Same choice
-- as everywhere else since 013.
--
-- ## Read-only
--
-- No table, no trigger, no write. Rollback is a single DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.sla_watch(
  p_token uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_sla constant int := 3;
  v_due jsonb;
  v_due_count int := 0;
  v_late int := 0;
  v_open int := 0;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'technician' THEN
    RAISE EXCEPTION 'Only a supervisor can see the SLA watch list';
  END IF;

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  -- Everything still open, and where it sits against the promise.
  SELECT
    count(*),
    count(*) FILTER (
      WHERE (COALESCE(t.reported_date, t.created_at::date)) = CURRENT_DATE - v_sla
    ),
    count(*) FILTER (
      WHERE (COALESCE(t.reported_date, t.created_at::date)) < CURRENT_DATE - v_sla
    )
  INTO v_open, v_due_count, v_late
  FROM public.tasks t
  WHERE t.group_id = p_group_id
    AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked');

  -- The list itself: only the jobs that reach the deadline today. A job already
  -- late is not in this list; it is already accounted for by `over_sla`.
  SELECT COALESCE(
    jsonb_agg(to_jsonb(d) ORDER BY d.reported_date, d.line_number),
    '[]'::jsonb
  )
  INTO v_due
  FROM (
    SELECT
      t.id,
      t.line_number,
      t.customer_name,
      t.customer_phone,
      t.xaafada,
      t.cablebox_code_raw,
      t.status,
      t.priority,
      COALESCE(t.reported_date, t.created_at::date) AS reported_date,
      (CURRENT_DATE - COALESCE(t.reported_date, t.created_at::date)) AS days_waiting,
      COALESCE(u.full_name, c.name) AS assignee,
      (u.id IS NULL AND c.id IS NULL) AS is_unassigned
    FROM public.tasks t
    LEFT JOIN public.users u ON u.id = t.assigned_user_id
    LEFT JOIN public.crews c ON c.id = t.assigned_crew_id
    WHERE t.group_id = p_group_id
      AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
      AND COALESCE(t.reported_date, t.created_at::date) = CURRENT_DATE - v_sla
  ) d;

  RETURN jsonb_build_object(
    'sla_days', v_sla,
    'today', CURRENT_DATE,
    'due_today', v_due,
    'due_count', v_due_count,
    'late_count', v_late,
    'open_count', v_open,
    'unassigned_due', (
      SELECT count(*)
      FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.status = 'unassigned'
        AND COALESCE(t.reported_date, t.created_at::date) = CURRENT_DATE - v_sla
    ),
    'server_now', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sla_watch(uuid, uuid) TO anon, authenticated;

-- ============================================================================
-- Rollback
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.sla_watch(uuid, uuid);
--
-- Nothing is created, altered or stored. No deadline is changed, no task is
-- touched, and SLA_DAYS remains 3 everywhere it is defined.
-- ============================================================================
