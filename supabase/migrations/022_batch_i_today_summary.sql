-- ============================================================================
-- 022 — what needs attention today
--
-- The supervisor's landing screen was a build-progress roadmap: five green
-- ticks saying "Phase 1 Live", "Phase 2 Live". True, and useless to somebody
-- standing up a dispatch at 07:30 with three crews waiting for work. The most
-- valuable space on the screen was spent telling the department what had
-- already been built, while the question actually being asked was "what is
-- still open, what is blocked, and who is out?"
--
-- `group_overview` answers part of that: open tasks, unassigned, crews,
-- technicians. It cannot answer the rest — blocked, running, overdue, done
-- today — without being rewritten, and rewriting a 5 kB SECURITY DEFINER
-- function by hand to add keys is the §17.2 failure that broke this exact
-- screen once already (an invented jsonb shape, valid object, missing keys,
-- nothing failing loudly).
--
-- So this is additive, like 021. A new function cannot break a caller that
-- does not know it exists.
--
-- Day boundary
-- ------------
-- The server runs in UTC. Hargeisa is UTC+3, so "today" differs by three hours
-- at exactly the moment a night shift finishes and a morning shift starts —
-- which is the moment a supervisor most needs the number to be right. A job
-- closed at 00:30 local would fall into "yesterday" on a UTC server.
--
-- The caller therefore passes the day it means, computed in the browser with
-- the same `todayKey()` the rest of the app uses. Passing NULL falls back to
-- the server's UTC date, which is only right for a caller that has no idea
-- where it is; the returned `day` says which one was used, so a disagreement
-- is visible rather than silent.
-- ============================================================================

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

    -- The four states a job can be in and still be someone's problem.
    'open_now',     count(*) FILTER (WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')),
    'unassigned',   count(*) FILTER (WHERE t.status = 'unassigned'),
    'assigned',     count(*) FILTER (WHERE t.status = 'assigned'),
    'in_progress',  count(*) FILTER (WHERE t.status = 'in_progress'),
    'blocked',      count(*) FILTER (WHERE t.status = 'blocked'),

    -- Open and past the department's promise. Same 3-day rule as the screen;
    -- `tests/sla.test.ts` fails the build if this ever differs from SLA_DAYS.
    'over_sla',     count(*) FILTER (
                      WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
                        AND coalesce(t.reported_date::timestamptz, t.created_at) < now() - interval '3 days'
                    ),

    -- Movement today, which is what tells a supervisor whether the day is
    -- going anywhere: arrived, closed.
    'created_today',   count(*) FILTER (WHERE t.created_at >= v_day::timestamptz AND t.created_at < (v_day + 1)::timestamptz),
    'completed_today', count(*) FILTER (WHERE t.completed_at >= v_day::timestamptz AND t.completed_at < (v_day + 1)::timestamptz)
  )
  INTO v_result
  FROM public.tasks t
  WHERE t.group_id = p_group_id;

  -- Who is out, counted from the work rather than from the roster: a crew with
  -- no running job is not "out", however many members it has.
  v_result := v_result || jsonb_build_object(
    'crews_out', (
      SELECT count(DISTINCT t.assigned_crew_id)
      FROM public.tasks t
      WHERE t.group_id = p_group_id AND t.status = 'in_progress' AND t.assigned_crew_id IS NOT NULL
    ),
    'crews_total', (
      SELECT count(*) FROM public.crews c WHERE c.group_id = p_group_id AND c.is_active
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
  'Operational counts for one day: open/blocked/unassigned jobs, overdue, crews out, arrived and completed today. The day is passed by the caller because the server is UTC and the field is UTC+3.';

GRANT EXECUTE ON FUNCTION public.today_summary(uuid, uuid, date) TO anon, authenticated;
