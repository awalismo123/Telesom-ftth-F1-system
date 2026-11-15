-- ============================================================================
-- 029 — Technician workload
-- ============================================================================
--
-- A supervisor needs to know who is carrying too much *right now*, and how long
-- jobs actually take. Nothing else.
--
-- ## Why this is a separate function
--
-- `analytics` is a 600-line function that already redefines itself across four
-- migrations (006, 012, 013, 014). Editing it to add four fields would put the
-- whole supervisor dashboard behind one typo. This adds one read-only function
-- beside it: no table, no column, nothing to migrate, and the rollback is a
-- single DROP FUNCTION.
--
-- ## Why the median, and why some timers are left out of it
--
-- KNOWN_LIMITS §7d: the live average is 916 minutes because one timer was left
-- running for 45.7 hours. The average of three jobs is then entirely that one
-- job, and it describes nobody's working day.
--
-- §7d also says what to do about it: *"a median alongside the mean, plus a rule
-- that flags any completion whose duration exceeds the job's own age — not a
-- silent cap."*
--
-- So a completion is **implausible** when its recorded time is longer than the
-- job has existed. That is not a judgement about the technician, it is
-- arithmetic: nobody can work on a job for longer than the job has existed. The
-- implausible ones are counted and reported as `implausible_timers`, never
-- dropped in silence, and only they are excluded from the median.
--
-- ## What this function does NOT do
--
-- It does not rank. There is no ORDER BY completed, no score, no ratio. The
-- caller sorts alphabetically. A list ordered by jobs closed is a leaderboard,
-- and a leaderboard makes a technician close a job before it is fixed.

CREATE OR REPLACE FUNCTION public.tech_workload(
  p_token uuid,
  p_group_id uuid,
  p_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_days int := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_from_date date := CURRENT_DATE - (GREATEST(1, LEAST(COALESCE(p_days, 30), 365)) - 1);
  v_from_ts timestamptz := v_from_date::timestamptz;
  v_techs jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'technician' THEN
    RAISE EXCEPTION 'Only a supervisor can see technician workload';
  END IF;

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb)
  INTO v_techs
  FROM (
    SELECT
      u.id AS user_id,
      u.full_name AS name,
      u.role,

      -- Carrying now: assigned to them, or to a crew they are in, and still live.
      (
        SELECT count(*)
        FROM public.tasks t
        WHERE t.status IN ('assigned', 'in_progress', 'blocked')
          AND (
            t.assigned_user_id = u.id
            OR (t.assigned_crew_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.crew_members cm
              WHERE cm.crew_id = t.assigned_crew_id AND cm.user_id = u.id
            ))
          )
      ) AS open_now,

      (
        SELECT count(*) FROM public.tasks t
        WHERE t.status = 'in_progress'
          AND (
            t.assigned_user_id = u.id
            OR (t.assigned_crew_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.crew_members cm
              WHERE cm.crew_id = t.assigned_crew_id AND cm.user_id = u.id
            ))
          )
      ) AS running_now,

      (
        SELECT count(*) FROM public.tasks t
        WHERE t.status = 'blocked'
          AND (
            t.assigned_user_id = u.id
            OR (t.assigned_crew_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.crew_members cm
              WHERE cm.crew_id = t.assigned_crew_id AND cm.user_id = u.id
            ))
          )
      ) AS blocked_now,

      c.completed,
      c.implausible_timers,
      c.durations,

      -- Where the open work sits, by day. Uses the scheduled date when the job
      -- has one and the report date otherwise, and says which with `basis`.
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('date', d.day, 'open', d.n) ORDER BY d.day)
        FROM (
          SELECT
            COALESCE(t.scheduled_date, t.reported_date) AS day,
            count(*) AS n
          FROM public.tasks t
          WHERE t.status IN ('assigned', 'in_progress', 'blocked')
            AND (
              t.assigned_user_id = u.id
              OR (t.assigned_crew_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.crew_members cm
                WHERE cm.crew_id = t.assigned_crew_id AND cm.user_id = u.id
              ))
            )
          GROUP BY 1
        ) d
      ), '[]'::jsonb) AS open_by_day

    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT
        -- Counts cover every completion in the window. Only the duration array
        -- is capped, so `completed` can never be understated by the cap.
        (
          SELECT count(*)
          FROM public.tasks t2
          WHERE t2.completed_by = u.id
            AND t2.status = 'completed'
            AND t2.completed_at >= v_from_ts
            AND t2.completed_at < (CURRENT_DATE + 1)::timestamptz
        ) AS completed,

        -- More recorded time than the job has existed: the timer was left
        -- running. Counted and shown, never silently dropped or capped.
        (
          SELECT count(*)
          FROM public.tasks t2
          WHERE t2.completed_by = u.id
            AND t2.status = 'completed'
            AND t2.completed_at >= v_from_ts
            AND t2.completed_at < (CURRENT_DATE + 1)::timestamptz
            AND t2.accumulated_seconds > EXTRACT(EPOCH FROM (t2.completed_at - t2.created_at))
        ) AS implausible_timers,

        (
          SELECT COALESCE(array_agg(d.seconds ORDER BY d.completed_at DESC), ARRAY[]::int[])
          FROM (
            SELECT t3.accumulated_seconds AS seconds, t3.completed_at
            FROM public.tasks t3
            WHERE t3.completed_by = u.id
              AND t3.status = 'completed'
              AND t3.completed_at >= v_from_ts
              AND t3.completed_at < (CURRENT_DATE + 1)::timestamptz
              AND t3.accumulated_seconds <= EXTRACT(EPOCH FROM (t3.completed_at - t3.created_at))
            ORDER BY t3.completed_at DESC
            LIMIT 500
          ) d
        ) AS durations
    ) c ON TRUE

    WHERE u.group_id = p_group_id
      AND u.is_active
      AND u.role IN ('technician', 'supervisor')
  ) x;

  RETURN jsonb_build_object(
    'from', v_from_date,
    'to', CURRENT_DATE,
    'days', v_days,
    'basis', 'completion',
    'techs', v_techs,
    'server_now', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tech_workload(uuid, uuid, int) TO anon, authenticated;

-- ============================================================================
-- Rollback
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.tech_workload(uuid, uuid, int);
--
-- Nothing is created, altered or stored. No task is touched, no timer is
-- changed, no duration is rewritten: the figures are recomputed on every call,
-- so a rollback loses no data at all.
-- ============================================================================
