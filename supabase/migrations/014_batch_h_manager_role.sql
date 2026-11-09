-- ============================================================================
-- 014 — Batch H, part 3: the read-only manager
--
-- The last manager question in `PRODUCTION_READINESS.md`:
--
--   "Can a manager see it without changing anything? ... Show me F2 and F3 too."
--
-- Until now there were two roles. A manager is a third, and it is deliberately
-- built as a **separate set of functions** rather than by loosening the
-- supervisor's group checks:
--
--   * every supervisor function still refuses a non-member, unchanged;
--   * every manager function refuses a non-manager;
--   * none of the manager functions writes a row — not one INSERT, UPDATE or
--     DELETE appears below, and `tests/manager.test.ts` fails the build if one
--     is ever added.
--
-- A manager therefore cannot assign, cancel, complete, import, edit a port or
-- change a PIN through the app, because there is no function to call.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The third role
-- ----------------------------------------------------------------------------

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('supervisor', 'technician', 'manager'));

COMMENT ON COLUMN public.users.role IS
  'supervisor (runs one group) | technician (works jobs) | manager (read-only, sees every group).';

-- ----------------------------------------------------------------------------
-- 2. A supervisor must not be able to mint a manager
-- ----------------------------------------------------------------------------
-- The group screen can create supervisors and technicians. A manager sees F2 and
-- F3, so the same screen would have been a privilege escalation: a group
-- supervisor could create an account they know the PIN of, sign in as it, and
-- read the other groups. The guard is one line, and the function is otherwise
-- the same as migration 011.

CREATE OR REPLACE FUNCTION public.upsert_team_member(
  p_token uuid,
  p_member_id uuid,
  p_group_id uuid,
  p_username text,
  p_full_name text,
  p_phone text,
  p_role text,
  p_pin text,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_target_id uuid;
  v_clean_username text := lower(regexp_replace(trim(p_username), '\s+', '_', 'g'));
  v_clean_phone text := NULLIF(trim(COALESCE(p_phone, '')), '');
BEGIN
  v_caller := public.get_session_user(p_token);
  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage team members';
  END IF;

  IF p_role NOT IN ('supervisor', 'technician') THEN
    RAISE EXCEPTION 'A manager account is created by the administrator, not from a group screen';
  END IF;

  IF p_member_id IS NULL THEN
    IF COALESCE(trim(p_pin), '') !~ '^\d{4,6}$' THEN
      RAISE EXCEPTION 'New member requires a 4 to 6 digit PIN';
    END IF;

    INSERT INTO public.users (group_id, username, full_name, phone, role, is_active, must_change_pin)
    VALUES (p_group_id, v_clean_username, trim(p_full_name), v_clean_phone, p_role, p_is_active, true)
    RETURNING id INTO v_target_id;

    INSERT INTO public.user_credentials (user_id, pin_hash)
    VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')));
  ELSE
    UPDATE public.users
    SET group_id = p_group_id,
        username = v_clean_username,
        full_name = trim(p_full_name),
        phone = v_clean_phone,
        role = p_role,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_member_id
    RETURNING id INTO v_target_id;

    IF COALESCE(trim(p_pin), '') <> '' THEN
      IF trim(p_pin) !~ '^\d{4,6}$' THEN
        RAISE EXCEPTION 'PIN must be 4 to 6 digits';
      END IF;
      INSERT INTO public.user_credentials (user_id, pin_hash)
      VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')))
      ON CONFLICT (user_id) DO UPDATE
      SET pin_hash = EXCLUDED.pin_hash, updated_at = now();

      -- A reset PIN is the supervisor's too, so it must be replaced as well.
      UPDATE public.users SET must_change_pin = true WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN v_target_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Read-only, enforced below the screens
-- ----------------------------------------------------------------------------
-- Hiding a button is a suggestion. A manager holds a session token and the anon
-- key is in the bundle, so the promise "read-only" has to live in the database.
--
-- `get_session_user` stamps the caller's role into a transaction-local setting;
-- a trigger on every operational table refuses the write when that role is
-- `manager`. The four functions that a plain group member may legitimately call
-- (set_port_status, upload_sheet_image, log_dispatch, ensure_cablebox) therefore
-- refuse a manager without any of them having to carry the check — and so will
-- the next one that is written.
--
-- `users`, `user_credentials` and `user_sessions` are deliberately **not**
-- guarded: a manager must still be able to change their own PIN and sign out.

CREATE OR REPLACE FUNCTION public.get_session_user(p_token uuid)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Session token required';
  END IF;

  SELECT u.* INTO v_user
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND u.is_active = true;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;

  PERFORM set_config('app.actor_role', v_user.role, true);

  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_manager_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF coalesce(current_setting('app.actor_role', true), '') = 'manager' THEN
    RAISE EXCEPTION 'A manager account is read-only';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks', 'task_work_logs', 'task_photos', 'dispatch_log', 'import_batches',
    'cableboxes', 'cablebox_ports', 'cablebox_logs', 'sheet_images',
    'crews', 'crew_members', 'groups'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS block_manager_writes ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER block_manager_writes BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_manager_writes()',
      t
    );
  END LOOP;
END;
$do$;

-- ----------------------------------------------------------------------------
-- 4. Portfolio — every group, at a glance
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.manager_portfolio(p_token uuid, p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval;
  v_groups jsonb;
  v_totals jsonb;
BEGIN
  v_user := public.get_session_user(p_token);

  IF v_user.role <> 'manager' THEN
    RAISE EXCEPTION 'Only the manager can see every group';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.code), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT
      g.id,
      g.code,
      g.name,
      g.is_active,
      (SELECT count(*) FROM public.users u
        WHERE u.group_id = g.id AND u.is_active AND u.role IN ('supervisor', 'technician')) AS members,
      (SELECT count(*) FROM public.users u
        WHERE u.group_id = g.id AND u.is_active AND u.role = 'technician') AS technicians,
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id AND t.status = 'unassigned') AS unassigned,
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id AND t.status IN ('assigned', 'in_progress', 'blocked')) AS active,
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id AND t.status = 'blocked') AS blocked,
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id
          AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
          AND t.is_urgent) AS urgent,
      -- The promise, measured from the day the customer reported the fault.
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id
          AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
          AND coalesce(t.reported_date::timestamptz, t.created_at) < now() - interval '3 days') AS waiting_over_sla,
      (SELECT count(*) FROM public.tasks t
        WHERE t.group_id = g.id AND t.status = 'completed'
          AND t.completed_at >= v_since) AS completed,
      (SELECT count(*) FROM public.task_photos p
        WHERE p.group_id = g.id AND p.created_at >= v_since) AS photos,
      (SELECT coalesce(round(avg(t.accumulated_seconds) / 60.0), 0) FROM public.tasks t
        WHERE t.group_id = g.id AND t.status = 'completed'
          AND t.completed_at >= v_since AND t.accumulated_seconds > 0) AS avg_minutes,
      (SELECT max(w.created_at) FROM public.task_work_logs w
        JOIN public.tasks t ON t.id = w.task_id
        WHERE t.group_id = g.id) AS last_activity_at
    FROM public.groups g
  ) x;

  -- Sums of the rows above. Averages are not averaged again.
  SELECT jsonb_build_object(
    'members', coalesce(sum((e ->> 'members')::int), 0),
    'technicians', coalesce(sum((e ->> 'technicians')::int), 0),
    'unassigned', coalesce(sum((e ->> 'unassigned')::int), 0),
    'active', coalesce(sum((e ->> 'active')::int), 0),
    'blocked', coalesce(sum((e ->> 'blocked')::int), 0),
    'urgent', coalesce(sum((e ->> 'urgent')::int), 0),
    'waiting_over_sla', coalesce(sum((e ->> 'waiting_over_sla')::int), 0),
    'completed', coalesce(sum((e ->> 'completed')::int), 0),
    'photos', coalesce(sum((e ->> 'photos')::int), 0),
    'groups', jsonb_array_length(v_groups),
    'live_groups', coalesce(count(*) filter (where (e ->> 'is_active')::boolean), 0)
  )
  INTO v_totals
  FROM jsonb_array_elements(v_groups) e;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'groups', v_groups,
    'totals', v_totals
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. The record, across groups
-- ----------------------------------------------------------------------------
-- The same merged feed as `group_activity`, with the group code on every row so
-- a manager can tell F1 from F3. `p_group_id` narrows it when one group is being
-- discussed; null means all of them.

CREATE OR REPLACE FUNCTION public.manager_activity(
  p_token uuid,
  p_days int DEFAULT 7,
  p_group_id uuid DEFAULT NULL,
  p_limit int DEFAULT 300
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

  IF v_user.role <> 'manager' THEN
    RAISE EXCEPTION 'Only the manager can read every group';
  END IF;

  v_since := now() - (greatest(1, least(coalesce(p_days, 7), 400)) || ' days')::interval;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.at DESC)
    FROM (
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
        NULL::int AS task_count,
        t.proof_photo_id AS photo_id,
        g.code AS group_code,
        g.id AS group_id
      FROM public.task_work_logs w
      JOIN public.tasks t ON t.id = w.task_id
      JOIN public.groups g ON g.id = t.group_id
      LEFT JOIN public.users u ON u.id = w.user_id
      WHERE w.created_at >= v_since
        AND (p_group_id IS NULL OR t.group_id = p_group_id)

      UNION ALL

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
        d.task_count,
        NULL,
        g.code,
        g.id
      FROM public.dispatch_log d
      JOIN public.groups g ON g.id = d.group_id
      LEFT JOIN public.users u ON u.id = d.sent_by
      WHERE d.created_at >= v_since
        AND (p_group_id IS NULL OR d.group_id = p_group_id)

      UNION ALL

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
        NULL,
        NULL,
        g.code,
        g.id
      FROM public.tasks t
      JOIN public.groups g ON g.id = t.group_id
      LEFT JOIN public.users u ON u.id = t.cancelled_by
      WHERE t.cancelled_at IS NOT NULL
        AND t.cancelled_at >= v_since
        AND (p_group_id IS NULL OR t.group_id = p_group_id)

      UNION ALL

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
        NULL,
        NULL,
        g.code,
        g.id
      FROM public.tasks t
      JOIN public.groups g ON g.id = t.group_id
      LEFT JOIN public.users u ON u.id = t.created_by
      WHERE t.source = 'manual'
        AND t.created_at >= v_since
        AND (p_group_id IS NULL OR t.group_id = p_group_id)

      ORDER BY at DESC
      LIMIT greatest(1, least(coalesce(p_limit, 300), 500))
    ) x
  ), '[]'::jsonb);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 6. Period statistics, as an internal helper
-- ----------------------------------------------------------------------------
-- Extracted so a manager's per-group rows and the portfolio totals use exactly
-- the same arithmetic as each other. `p_group_id` null means "all groups".
--
-- This function takes no token, so it is **revoked from every role** below and
-- reached only through manager_report / manager_portfolio, which check the
-- caller first.

CREATE OR REPLACE FUNCTION public.internal_period_stats(
  p_group_id uuid,
  p_from_ts timestamptz,
  p_to_ts timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $h$
  SELECT jsonb_build_object(
    'created', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
        AND t.created_at >= p_from_ts AND t.created_at < p_to_ts
    ),
    'completed', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id) AND t.status = 'completed'
        AND t.completed_at >= p_from_ts AND t.completed_at < p_to_ts
    ),
    'cancelled', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
        AND t.cancelled_at >= p_from_ts AND t.cancelled_at < p_to_ts
    ),
    'open_at_end', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
        AND t.created_at < p_to_ts
        AND (t.completed_at IS NULL OR t.completed_at >= p_to_ts)
        AND (t.cancelled_at IS NULL OR t.cancelled_at >= p_to_ts)
    ),
    'waiting_over_sla', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
        AND t.created_at < p_to_ts
        AND (t.completed_at IS NULL OR t.completed_at >= p_to_ts)
        AND (t.cancelled_at IS NULL OR t.cancelled_at >= p_to_ts)
        AND coalesce(t.reported_date::timestamptz, t.created_at) < p_to_ts - interval '3 days'
    ),
    'avg_minutes', (
      SELECT coalesce(round(avg(t.accumulated_seconds) / 60.0), 0)
      FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id) AND t.status = 'completed'
        AND t.completed_at >= p_from_ts AND t.completed_at < p_to_ts
        AND t.accumulated_seconds > 0
    ),
    'avg_dbm', (
      SELECT round(avg(t.optical_dbm)::numeric, 1)
      FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id) AND t.status = 'completed'
        AND t.completed_at >= p_from_ts AND t.completed_at < p_to_ts
        AND t.optical_dbm IS NOT NULL
    ),
    'repeat_faults', (
      SELECT count(*) FROM public.tasks t
      WHERE (p_group_id IS NULL OR t.group_id = p_group_id) AND t.is_repeat_fault
        AND t.created_at >= p_from_ts AND t.created_at < p_to_ts
    ),
    'dispatches', (
      SELECT count(*) FROM public.dispatch_log d
      WHERE (p_group_id IS NULL OR d.group_id = p_group_id)
        AND d.created_at >= p_from_ts AND d.created_at < p_to_ts
    ),
    'photos', (
      SELECT count(*) FROM public.task_photos p
      WHERE (p_group_id IS NULL OR p.group_id = p_group_id)
        AND p.created_at >= p_from_ts AND p.created_at < p_to_ts
    )
  );
$h$;

REVOKE ALL ON FUNCTION public.internal_period_stats(uuid, timestamptz, timestamptz) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 7. The period report, across groups
-- ----------------------------------------------------------------------------
-- Same shape as `period_report` (so the same sheet renders it) plus a `groups`
-- array, which is what a manager reads first.

CREATE OR REPLACE FUNCTION public.manager_report(
  p_token uuid,
  p_from date,
  p_to date,
  p_group_id uuid DEFAULT NULL
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

  IF v_user.role <> 'manager' THEN
    RAISE EXCEPTION 'Only the manager can read every group';
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
    'scope', 'manager',

    'groups', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code)
      FROM (
        SELECT
          g.id,
          g.code,
          g.name,
          public.internal_period_stats(g.id, v_from_ts, v_to_ts) AS totals
        FROM public.groups g
        -- A group that has not launched contributes four zeroes, which reads as
        -- a failure rather than as "not started". The portfolio shows them all;
        -- the report keeps to the groups that are running.
        WHERE g.is_active
          AND (p_group_id IS NULL OR g.id = p_group_id)
      ) x
    ), '[]'::jsonb),

    'totals', public.internal_period_stats(p_group_id, v_from_ts, v_to_ts),

    'techs', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.completed DESC, x.name)
      FROM (
        SELECT
          u.id,
          u.full_name AS name,
          g.code AS group_code,
          count(t.id) AS completed,
          coalesce(round(avg(t.accumulated_seconds) / 60.0), 0) AS avg_minutes,
          round(avg(t.optical_dbm)::numeric, 1) AS avg_dbm
        FROM public.users u
        JOIN public.groups g ON g.id = u.group_id
        LEFT JOIN public.tasks t
          ON t.completed_by = u.id
         AND t.status = 'completed'
         AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
        WHERE u.role IN ('technician', 'supervisor')
          AND (p_group_id IS NULL OR u.group_id = p_group_id)
        GROUP BY u.id, u.full_name, g.code
      ) x
    ), '[]'::jsonb),

    'boxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.faults DESC, x.box_code)
      FROM (
        SELECT
          b.box_code,
          g.code AS group_code,
          b.health_status,
          b.total_ports,
          coalesce(cardinality(b.damaged_ports), 0) AS damaged_ports,
          (SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = b.id
              AND t.created_at >= v_from_ts AND t.created_at < v_to_ts) AS faults
        FROM public.cableboxes b
        JOIN public.groups g ON g.id = b.group_id
        WHERE (p_group_id IS NULL OR b.group_id = p_group_id)
        ORDER BY 6 DESC
        LIMIT 20
      ) x
    ), '[]'::jsonb),

    'cancel_reasons', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.count DESC)
      FROM (
        SELECT coalesce(t.cancel_reason, 'unspecified') AS reason, count(*) AS count
        FROM public.tasks t
        WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
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
            WHERE (p_group_id IS NULL OR t.group_id = p_group_id) AND t.status = 'completed'
              AND t.completed_at >= d AND t.completed_at < d + interval '1 day') AS completed,
          (SELECT count(*) FROM public.tasks t
            WHERE (p_group_id IS NULL OR t.group_id = p_group_id)
              AND t.created_at >= d AND t.created_at < d + interval '1 day') AS created
        FROM generate_series(v_from_ts, v_to_ts - interval '1 day', interval '1 day') AS d
      ) x
    ), '[]'::jsonb)
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 8. The open jobs of one group, read-only
-- ----------------------------------------------------------------------------
-- So a manager can look at the blocked jobs behind a red tile without being
-- handed the dispatch board, its checkboxes and its assign bar.

CREATE OR REPLACE FUNCTION public.manager_tasks(p_token uuid, p_group_id uuid)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  IF v_user.role <> 'manager' THEN
    RAISE EXCEPTION 'Only the manager can read every group';
  END IF;

  RETURN QUERY
    SELECT t.* FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    ORDER BY t.is_urgent DESC, t.reported_date ASC NULLS LAST, t.created_at ASC
    LIMIT 300;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.manager_portfolio(uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_activity(uuid, int, uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_report(uuid, date, date, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_tasks(uuid, uuid) TO anon, authenticated;
