-- ============================================================================
-- 012 — Batch H, part 1: the record
--
-- Two questions a department head asks in the second meeting, and neither had a
-- screen:
--
--   "Show me who changed this job, and when."
--   "What did we actually do last month?"
--
-- The data was already being written — `task_work_logs`, `dispatch_log`, the
-- cancellation columns — but only the *current state* was ever displayed. This
-- migration turns the trail into two functions:
--
--   group_activity()  a merged, filterable feed of everything that happened
--   period_report()   a date range, as numbers a manager can print
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One feed of everything that happened in a group
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.group_activity(
  p_token uuid,
  p_group_id uuid,
  p_days int DEFAULT 7,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
  v_since timestamptz;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_since := now() - (greatest(1, least(p_days, 400)) || ' days')::interval;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.at DESC)
    FROM (
      -- Every state change on a job: assigned, started, blocked, resumed, completed…
      SELECT
        w.created_at AS at,
        w.action AS kind,
        'job' AS subject,
        t.id AS task_id,
        t.line_number,
        t.customer_name,
        coalesce(u.full_name, '—') AS actor,
        w.session_seconds AS seconds,
        w.optical_dbm AS dbm,
        w.blocker_reason AS reason,
        w.notes AS notes,
        NULL::text AS channel,
        NULL::int AS task_count
      FROM public.task_work_logs w
      JOIN public.tasks t ON t.id = w.task_id
      LEFT JOIN public.users u ON u.id = w.user_id
      WHERE t.group_id = p_group_id
        AND w.created_at >= v_since

      UNION ALL

      -- A plan that was sent to the group chat: who sent it, on which channel,
      -- and how much work it contained.
      SELECT
        d.created_at,
        'dispatched',
        'dispatch',
        NULL,
        NULL,
        NULL,
        coalesce(u.full_name, '—'),
        NULL,
        NULL,
        NULL,
        NULL,
        d.channel,
        d.task_count
      FROM public.dispatch_log d
      LEFT JOIN public.users u ON u.id = d.sent_by
      WHERE d.group_id = p_group_id
        AND d.created_at >= v_since

      UNION ALL

      -- A job that was cancelled: the reason is the interesting part, and it
      -- lives on the task rather than in the work log.
      SELECT
        t.cancelled_at,
        'cancelled',
        'job',
        t.id,
        t.line_number,
        t.customer_name,
        coalesce(u.full_name, '—'),
        NULL,
        NULL,
        t.cancel_reason,
        NULL,
        NULL,
        NULL
      FROM public.tasks t
      LEFT JOIN public.users u ON u.id = t.cancelled_by
      WHERE t.group_id = p_group_id
        AND t.cancelled_at IS NOT NULL
        AND t.cancelled_at >= v_since

      UNION ALL

      -- A job that arrived by phone call rather than on the sheet.
      SELECT
        t.created_at,
        'manual_created',
        'job',
        t.id,
        t.line_number,
        t.customer_name,
        coalesce(u.full_name, '—'),
        NULL,
        NULL,
        NULL,
        t.intake_notes,
        NULL,
        NULL
      FROM public.tasks t
      LEFT JOIN public.users u ON u.id = t.created_by
      WHERE t.group_id = p_group_id
        AND t.source = 'manual'
        AND t.created_at >= v_since

      ORDER BY at DESC
      LIMIT greatest(1, least(p_limit, 500))
    ) x
  ), '[]'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION public.group_activity(uuid, uuid, int, int) IS
  'Merged audit feed for one group: job changes, dispatch sends, cancellations, phone-in jobs.';

-- ----------------------------------------------------------------------------
-- 2. A period, as a report a manager can print
-- ----------------------------------------------------------------------------

/**
 * Everything a one-page report needs for a date range the supervisor chooses.
 *
 * Deliberately returns *aggregates and a short list*, not every row: a PDF is
 * read by a person, and 300 rows of job detail is a spreadsheet, not a report.
 */
CREATE OR REPLACE FUNCTION public.period_report(
  p_token uuid,
  p_group_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
  v_from date := coalesce(p_from, current_date - 6);
  v_to date := coalesce(p_to, current_date);
  v_from_ts timestamptz;
  v_to_ts timestamptz;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  IF v_to < v_from THEN
    RAISE EXCEPTION 'The end of the period is before its start';
  END IF;

  IF (v_to - v_from) > 366 THEN
    RAISE EXCEPTION 'A report cannot cover more than a year';
  END IF;

  v_from_ts := v_from::timestamptz;
  v_to_ts := (v_to + 1)::timestamptz;

  RETURN jsonb_build_object(
    'from', v_from,
    'to', v_to,

    'totals', jsonb_build_object(
      -- What arrived (a new row, from a sheet or a phone call) …
      'created', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
      ),
      -- … what was finished …
      'completed', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
      ),
      -- … what was dropped, with the reasons below.
      'cancelled', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.cancelled_at >= v_from_ts AND t.cancelled_at < v_to_ts
      ),
      -- Still open at the end of the period — not "unfinished work today".
      'open_at_end', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
          AND t.created_at < v_to_ts
      ),
      -- The number that matters most: open work older than the SLA.
      'waiting_over_sla', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
          AND t.created_at < v_to_ts - interval '3 days'
      ),
      'avg_minutes', (
        SELECT coalesce(round(avg(t.accumulated_seconds) / 60.0), 0)
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
          AND t.accumulated_seconds > 0
      ),
      'avg_dbm', (
        SELECT round(avg(t.optical_dbm)::numeric, 1)
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
          AND t.optical_dbm IS NOT NULL
      ),
      -- Work that took more than one visit to finish.
      'repeat_faults', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.is_repeat_fault
          AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
      ),
      'dispatches', (
        SELECT count(*) FROM public.dispatch_log d
        WHERE d.group_id = p_group_id
          AND d.created_at >= v_from_ts AND d.created_at < v_to_ts
      )
    ),

    'techs', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.completed DESC, x.name)
      FROM (
        SELECT
          u.id,
          u.full_name AS name,
          count(t.id) AS completed,
          coalesce(round(avg(t.accumulated_seconds) / 60.0), 0) AS avg_minutes,
          round(avg(t.optical_dbm)::numeric, 1) AS avg_dbm
        FROM public.users u
        LEFT JOIN public.tasks t
          ON t.completed_by = u.id
         AND t.status = 'completed'
         AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
        WHERE u.group_id = p_group_id AND u.role IN ('technician', 'supervisor')
        GROUP BY u.id, u.full_name
      ) x
    ), '[]'::jsonb),

    'boxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.faults DESC, x.box_code)
      FROM (
        SELECT
          b.box_code,
          b.health_status,
          b.total_ports,
          coalesce(cardinality(b.damaged_ports), 0) AS damaged_ports,
          (
            SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = b.id
              AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
          ) AS faults
        FROM public.cableboxes b
        WHERE b.group_id = p_group_id
      ) x
    ), '[]'::jsonb),

    'cancel_reasons', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.count DESC)
      FROM (
        SELECT coalesce(t.cancel_reason, 'unspecified') AS reason, count(*) AS count
        FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.cancelled_at >= v_from_ts AND t.cancelled_at < v_to_ts
        GROUP BY 1
      ) x
    ), '[]'::jsonb),

    'daily', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day)
      FROM (
        SELECT
          d::date AS day,
          (SELECT count(*) FROM public.tasks t
            WHERE t.group_id = p_group_id AND t.status = 'completed'
              AND t.completed_at >= d AND t.completed_at < d + interval '1 day') AS completed,
          (SELECT count(*) FROM public.tasks t
            WHERE t.group_id = p_group_id
              AND t.created_at >= d AND t.created_at < d + interval '1 day') AS created
        FROM generate_series(v_from_ts, v_to_ts - interval '1 day', interval '1 day') AS d
      ) x
    ), '[]'::jsonb)
  );
END;
$fn$;

COMMENT ON FUNCTION public.period_report(uuid, uuid, date, date) IS
  'One period, as aggregates: arrivals, completions, cancellations, SLA breaches, per technician and per box.';

GRANT EXECUTE ON FUNCTION public.group_activity(uuid, uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.period_report(uuid, uuid, date, date) TO anon, authenticated;
