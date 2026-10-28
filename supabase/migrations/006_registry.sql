-- ============================================================================
-- Migration 006 — Cablebox infrastructure registry & operations analytics
--
--   * cablebox_ports: the per-port map of every box (free / occupied / damaged
--     / reserved), editable from the field and always stamped with who did it.
--   * box_directory / box_detail: what a technician or supervisor sees about a
--     box — every past fault, the dBm trend, damaged ports, the jobs done there.
--   * set_port_status: mark a port damaged (or release it) straight from the
--     phone; the box's damaged_ports array, health and incident log follow.
--   * ops_analytics: jobs completed, average time on the job, urgent share,
--     repeat visits, blocker breakdown, chronic boxes and dBm quality.
--   * seed_demo_data / clear_demo_data: realistic 30-day sample history that is
--     flagged is_demo and can be removed in one tap.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Demo flag + the port map
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks          ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.cablebox_logs  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.cablebox_ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cablebox_id uuid NOT NULL REFERENCES public.cableboxes(id) ON DELETE CASCADE,
  port_number int NOT NULL CHECK (port_number BETWEEN 1 AND 32),
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('free', 'occupied', 'damaged', 'reserved', 'unknown')),
  line_number text,
  customer_name text,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cablebox_ports_unique UNIQUE (cablebox_id, port_number)
);

CREATE INDEX IF NOT EXISTS idx_cablebox_ports_box ON public.cablebox_ports(cablebox_id, port_number);
CREATE INDEX IF NOT EXISTS idx_cablebox_logs_box_time ON public.cablebox_logs(cablebox_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_cablebox ON public.tasks(cablebox_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON public.tasks(group_id, completed_at DESC);

ALTER TABLE public.cablebox_ports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read cablebox_ports" ON public.cablebox_ports;
CREATE POLICY "Allow read cablebox_ports" ON public.cablebox_ports FOR SELECT USING (true);

-- ----------------------------------------------------------------------------
-- 2. Internals — materialise ports, recompute a box's state
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_box_ports(p_box_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_box public.cableboxes;
  i int;
BEGIN
  SELECT * INTO v_box FROM public.cableboxes WHERE id = p_box_id;
  IF v_box.id IS NULL THEN
    RAISE EXCEPTION 'Cablebox not found';
  END IF;

  FOR i IN 1..v_box.total_ports LOOP
    INSERT INTO public.cablebox_ports (cablebox_id, port_number, status, notes)
    VALUES (
      p_box_id,
      i,
      CASE WHEN i = ANY (v_box.damaged_ports) THEN 'damaged' ELSE 'unknown' END,
      CASE WHEN i = ANY (v_box.damaged_ports)
           THEN 'Damaged before the register was digitised'
           ELSE NULL END
    )
    ON CONFLICT (cablebox_id, port_number) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_box_state(p_box_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_damaged int[];
  v_faults int;
  v_dbm numeric(5,2);
  v_health text;
BEGIN
  SELECT COALESCE(array_agg(port_number ORDER BY port_number), '{}'::int[])
    INTO v_damaged
  FROM public.cablebox_ports
  WHERE cablebox_id = p_box_id AND status = 'damaged';

  SELECT count(*) INTO v_faults
  FROM public.cablebox_logs
  WHERE cablebox_id = p_box_id
    AND created_at >= now() - interval '30 days'
    AND event_type IN ('cilada_fixed', 'fiber_break', 'box_full', 'port_damaged');

  SELECT l.optical_dbm INTO v_dbm
  FROM public.cablebox_logs l
  WHERE l.cablebox_id = p_box_id AND l.optical_dbm IS NOT NULL
  ORDER BY l.created_at DESC
  LIMIT 1;

  v_health := CASE
    WHEN COALESCE(array_length(v_damaged, 1), 0) >= 3 OR v_faults >= 4 THEN 'critical'
    WHEN COALESCE(array_length(v_damaged, 1), 0) >= 1 OR v_faults >= 1
         OR (v_dbm IS NOT NULL AND v_dbm < -27) THEN 'warning'
    ELSE 'healthy'
  END;

  UPDATE public.cableboxes
  SET damaged_ports = v_damaged,
      health_status = v_health,
      last_optical_dbm = COALESCE(v_dbm, last_optical_dbm),
      updated_at = now()
  WHERE id = p_box_id;

  RETURN v_health;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. box_directory — every box in the group with the numbers that matter
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.box_directory(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_start timestamptz := now() - interval '30 days';
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'You can only read your own group';
  END IF;

  -- make sure every box has its port rows before we count them
  PERFORM public.ensure_box_ports(cb.id)
  FROM public.cableboxes cb WHERE cb.group_id = p_group_id;

  RETURN jsonb_build_object(
    'boxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.rank, b.box_code)
      FROM (
        SELECT
          cb.id,
          cb.box_code,
          cb.xaafada,
          cb.olt_path,
          cb.total_ports,
          cb.health_status,
          cb.damaged_ports,
          cb.location_notes,
          cb.fault_count,
          cb.last_optical_dbm,
          CASE cb.health_status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END AS rank,
          (SELECT count(*) FROM public.cablebox_ports p
            WHERE p.cablebox_id = cb.id AND p.status = 'occupied') AS ports_used,
          (SELECT count(*) FROM public.cablebox_ports p
            WHERE p.cablebox_id = cb.id AND p.status = 'damaged') AS ports_damaged,
          (SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = cb.id AND t.status IN ('assigned', 'in_progress', 'blocked')) AS open_jobs,
          (SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = cb.id AND t.status = 'in_progress') AS running_jobs,
          (SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = cb.id AND t.status = 'completed'
              AND t.completed_at >= v_start) AS completed_30d,
          COALESCE((
            SELECT count(*) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id AND l.created_at >= v_start
              AND l.event_type IN ('cilada_fixed', 'fiber_break', 'box_full', 'port_damaged')
          ), 0) AS faults_30d,
          (SELECT round(avg(l.optical_dbm)::numeric, 2) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id AND l.created_at >= v_start) AS avg_dbm_30d,
          (SELECT max(l.created_at) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id) AS last_event_at
        FROM public.cableboxes cb
        WHERE cb.group_id = p_group_id
      ) b
    ), '[]'::jsonb),
    'demo', jsonb_build_object(
      'tasks', (SELECT count(*) FROM public.tasks WHERE group_id = p_group_id AND is_demo),
      'logs', (SELECT count(*) FROM public.cablebox_logs l
                 JOIN public.cableboxes cb ON cb.id = l.cablebox_id
                WHERE cb.group_id = p_group_id AND l.is_demo)
    ),
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. box_detail — one box, everything that ever happened there
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.box_detail(p_token uuid, p_box_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_box public.cableboxes;
  v_start timestamptz := now() - interval '30 days';
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_box FROM public.cableboxes WHERE id = p_box_id;
  IF v_box.id IS NULL THEN
    RAISE EXCEPTION 'Cablebox not found';
  END IF;
  IF v_box.group_id IS DISTINCT FROM v_caller.group_id THEN
    RAISE EXCEPTION 'This cablebox belongs to another group';
  END IF;

  PERFORM public.ensure_box_ports(v_box.id);

  RETURN jsonb_build_object(
    'box', jsonb_build_object(
      'id', v_box.id,
      'box_code', v_box.box_code,
      'xaafada', v_box.xaafada,
      'olt_path', v_box.olt_path,
      'total_ports', v_box.total_ports,
      'health_status', v_box.health_status,
      'damaged_ports', v_box.damaged_ports,
      'location_notes', v_box.location_notes,
      'fault_count', v_box.fault_count,
      'last_optical_dbm', v_box.last_optical_dbm,
      'ports_used', (SELECT count(*) FROM public.cablebox_ports p
                      WHERE p.cablebox_id = v_box.id AND p.status = 'occupied'),
      'ports_damaged', (SELECT count(*) FROM public.cablebox_ports p
                         WHERE p.cablebox_id = v_box.id AND p.status = 'damaged'),
      'ports_free', (SELECT count(*) FROM public.cablebox_ports p
                      WHERE p.cablebox_id = v_box.id AND p.status = 'free')
    ),
    'ports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'port_number', p.port_number,
        'status', p.status,
        'line_number', p.line_number,
        'customer_name', p.customer_name,
        'notes', p.notes,
        'updated_at', p.updated_at,
        'updated_by', u.full_name
      ) ORDER BY p.port_number)
      FROM public.cablebox_ports p
      LEFT JOIN public.users u ON u.id = p.updated_by
      WHERE p.cablebox_id = v_box.id
    ), '[]'::jsonb),
    'incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id,
        'event_type', x.event_type,
        'port_number', x.port_number,
        'optical_dbm', x.optical_dbm,
        'notes', x.notes,
        'created_at', x.created_at,
        'logged_by', x.logged_by,
        'line_number', x.line_number,
        'is_demo', x.is_demo
      ) ORDER BY x.created_at DESC)
      FROM (
        SELECT l.id, l.event_type, l.port_number, l.optical_dbm, l.notes,
               l.created_at, u.full_name AS logged_by, t.line_number, l.is_demo
        FROM public.cablebox_logs l
        LEFT JOIN public.users u ON u.id = l.logged_by
        LEFT JOIN public.tasks t ON t.id = l.task_id
        WHERE l.cablebox_id = v_box.id
        ORDER BY l.created_at DESC
        LIMIT 40
      ) x
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', j.id,
        'line_number', j.line_number,
        'customer_name', j.customer_name,
        'task_type', j.task_type,
        'status', j.status,
        'port_number', j.port_number,
        'optical_dbm', j.optical_dbm,
        'completed_at', j.completed_at,
        'duration_seconds', j.accumulated_seconds,
        'worker', j.worker,
        'is_demo', j.is_demo
      ) ORDER BY j.sort_at DESC)
      FROM (
        SELECT t.id, t.line_number, t.customer_name, t.task_type, t.status,
               t.port_number, t.optical_dbm, t.completed_at, t.accumulated_seconds,
               t.is_demo,
               COALESCE(c.name, u.full_name) AS worker,
               COALESCE(t.completed_at, t.created_at) AS sort_at
        FROM public.tasks t
        LEFT JOIN public.crews c ON c.id = t.assigned_crew_id
        LEFT JOIN public.users u ON u.id = t.assigned_user_id
        WHERE t.cablebox_id = v_box.id
        ORDER BY COALESCE(t.completed_at, t.created_at) DESC
        LIMIT 25
      ) j
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'faults_30d', (SELECT count(*) FROM public.cablebox_logs l
                      WHERE l.cablebox_id = v_box.id AND l.created_at >= v_start
                        AND l.event_type IN ('cilada_fixed', 'fiber_break', 'box_full', 'port_damaged')),
      'faults_all', (SELECT count(*) FROM public.cablebox_logs l
                      WHERE l.cablebox_id = v_box.id
                        AND l.event_type IN ('cilada_fixed', 'fiber_break', 'box_full', 'port_damaged')),
      'completed_30d', (SELECT count(*) FROM public.tasks t
                         WHERE t.cablebox_id = v_box.id AND t.status = 'completed'
                           AND t.completed_at >= v_start),
      'avg_dbm_30d', (SELECT round(avg(l.optical_dbm)::numeric, 2) FROM public.cablebox_logs l
                       WHERE l.cablebox_id = v_box.id AND l.created_at >= v_start),
      'last_dbm', (SELECT l.optical_dbm FROM public.cablebox_logs l
                    WHERE l.cablebox_id = v_box.id AND l.optical_dbm IS NOT NULL
                    ORDER BY l.created_at DESC LIMIT 1),
      'avg_minutes', (SELECT round(coalesce(avg(nullif(t.accumulated_seconds, 0)), 0) / 60.0)
                       FROM public.tasks t
                      WHERE t.cablebox_id = v_box.id AND t.status = 'completed'),
      'last_event_at', (SELECT max(l.created_at) FROM public.cablebox_logs l
                         WHERE l.cablebox_id = v_box.id)
    ),
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. set_port_status — the field edits the map, the database records who
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_port_status(
  p_token uuid,
  p_box_id uuid,
  p_port_number int,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_box public.cableboxes;
  v_old text;
  v_health text;
  v_note text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  v_caller := public.get_session_user(p_token);

  IF p_status NOT IN ('free', 'occupied', 'damaged', 'reserved', 'unknown') THEN
    RAISE EXCEPTION 'Unknown port status: %', p_status;
  END IF;

  SELECT * INTO v_box FROM public.cableboxes WHERE id = p_box_id;
  IF v_box.id IS NULL THEN
    RAISE EXCEPTION 'Cablebox not found';
  END IF;
  IF v_box.group_id IS DISTINCT FROM v_caller.group_id THEN
    RAISE EXCEPTION 'This cablebox belongs to another group';
  END IF;
  IF p_port_number IS NULL OR p_port_number < 1 OR p_port_number > v_box.total_ports THEN
    RAISE EXCEPTION 'Port % is outside 1…%', p_port_number, v_box.total_ports;
  END IF;

  PERFORM public.ensure_box_ports(v_box.id);

  SELECT status INTO v_old
  FROM public.cablebox_ports
  WHERE cablebox_id = v_box.id AND port_number = p_port_number;

  UPDATE public.cablebox_ports
  SET status = p_status,
      notes = COALESCE(v_note, notes),
      updated_by = v_caller.id,
      updated_at = now()
  WHERE cablebox_id = v_box.id AND port_number = p_port_number;

  IF p_status = 'damaged' AND v_old IS DISTINCT FROM 'damaged' THEN
    INSERT INTO public.cablebox_logs (cablebox_id, logged_by, event_type, port_number, notes)
    VALUES (v_box.id, v_caller.id, 'port_damaged', p_port_number,
            COALESCE(v_note, 'Port ' || p_port_number || ' marked damaged'));
  ELSIF v_old = 'damaged' AND p_status <> 'damaged' THEN
    INSERT INTO public.cablebox_logs (cablebox_id, logged_by, event_type, port_number, notes)
    VALUES (v_box.id, v_caller.id, 'note', p_port_number,
            COALESCE(v_note, 'Port ' || p_port_number || ' released (' || p_status || ')'));
  END IF;

  v_health := public.recompute_box_state(v_box.id);

  RETURN jsonb_build_object(
    'box_id', v_box.id,
    'port_number', p_port_number,
    'status', p_status,
    'damaged_ports', (SELECT COALESCE(array_agg(port_number ORDER BY port_number), '{}'::int[])
                        FROM public.cablebox_ports
                       WHERE cablebox_id = v_box.id AND status = 'damaged'),
    'health_status', v_health,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. ops_analytics — the supervisor's numbers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_analytics(
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
  v_days int := LEAST(GREATEST(COALESCE(p_days, 30), 1), 180);
  v_start timestamptz := now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 180) || ' days')::interval;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'You can only read your own group';
  END IF;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'totals', (
      SELECT jsonb_build_object(
        'completed', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start),
        'urgent_completed', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND t.priority = 'urgent'),
        'repeat_faults', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND t.is_repeat_fault),
        'avg_minutes', round(coalesce(avg(nullif(t.accumulated_seconds, 0))
                          FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start), 0) / 60.0),
        'avg_dbm', (SELECT round(avg(t2.optical_dbm)::numeric, 2) FROM public.tasks t2
                     WHERE t2.group_id = p_group_id AND t2.status = 'completed'
                       AND t2.completed_at >= v_start AND t2.optical_dbm IS NOT NULL),
        'open_now', count(*) FILTER (WHERE t.status IN ('unassigned', 'assigned')),
        'running_now', count(*) FILTER (WHERE t.status = 'in_progress'),
        'blocked_now', count(*) FILTER (WHERE t.status = 'blocked'),
        'active_days', count(DISTINCT t.completed_at::date) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start),
        'demo_tasks', count(*) FILTER (WHERE t.is_demo),
        'bands', jsonb_build_object(
          'healthy', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND t.optical_dbm BETWEEN -27 AND -8),
          'weak', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND t.optical_dbm < -27),
          'strong', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND t.optical_dbm > -8),
          'out', count(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= v_start AND (t.optical_dbm > 0 OR t.optical_dbm < -40))
        )
      )
      FROM public.tasks t
      WHERE t.group_id = p_group_id
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d, 'YYYY-MM-DD'),
        'completed', COALESCE(c.done, 0),
        'avg_minutes', COALESCE(c.avg_min, 0)
      ) ORDER BY d)
      FROM generate_series(v_start::date, now()::date, interval '1 day') d
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS done,
               round(coalesce(avg(nullif(t.accumulated_seconds, 0)), 0) / 60.0)::int AS avg_min
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at::date = d::date
      ) c ON true
    ), '[]'::jsonb),
    'techs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', COALESCE(d.name, l.name),
        'completed', COALESCE(d.done, 0),
        'urgent', COALESCE(d.urgent, 0),
        'repeats', COALESCE(d.repeats, 0),
        'avg_minutes', COALESCE(d.avg_min, 0),
        'avg_dbm', d.avg_dbm,
        'running_now', COALESCE(l.running, 0),
        'blocked_now', COALESCE(l.blocked, 0)
      ) ORDER BY COALESCE(d.done, 0) DESC, 1)
      FROM (
        SELECT COALESCE(cr.name, u.full_name) AS name,
               count(*) AS done,
               count(*) FILTER (WHERE t.priority = 'urgent') AS urgent,
               count(*) FILTER (WHERE t.is_repeat_fault) AS repeats,
               round(coalesce(avg(nullif(t.accumulated_seconds, 0)), 0) / 60.0)::int AS avg_min,
               round(avg(t.optical_dbm)::numeric, 2) AS avg_dbm
        FROM public.tasks t
        LEFT JOIN public.crews cr ON cr.id = t.assigned_crew_id
        LEFT JOIN public.users u ON u.id = t.assigned_user_id
        WHERE t.group_id = p_group_id AND t.status = 'completed' AND t.completed_at >= v_start
        GROUP BY 1
      ) d
      FULL JOIN (
        SELECT COALESCE(cr.name, u.full_name) AS name,
               count(*) FILTER (WHERE t.status = 'in_progress') AS running,
               count(*) FILTER (WHERE t.status = 'blocked') AS blocked
        FROM public.tasks t
        LEFT JOIN public.crews cr ON cr.id = t.assigned_crew_id
        LEFT JOIN public.users u ON u.id = t.assigned_user_id
        WHERE t.group_id = p_group_id AND t.status IN ('in_progress', 'blocked')
        GROUP BY 1
      ) l ON l.name = d.name
    ), '[]'::jsonb),
    'boxes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cb.id,
        'box_code', cb.box_code,
        'xaafada', cb.xaafada,
        'health_status', cb.health_status,
        'faults', COALESCE(s.faults, 0),
        'completed', COALESCE(s.completed, 0),
        'avg_dbm', s.avg_dbm,
        'last_event_at', s.last_event,
        'damaged_ports', (SELECT count(*) FROM public.cablebox_ports p
                          WHERE p.cablebox_id = cb.id AND p.status = 'damaged'),
        'chronic', COALESCE(s.faults, 0) >= 3
      ) ORDER BY COALESCE(s.faults, 0) DESC, cb.box_code)
      FROM public.cableboxes cb
      LEFT JOIN LATERAL (
        SELECT
          (SELECT count(*) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id AND l.created_at >= v_start
              AND l.event_type IN ('cilada_fixed', 'fiber_break', 'box_full', 'port_damaged')) AS faults,
          (SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = cb.id AND t.status = 'completed'
              AND t.completed_at >= v_start) AS completed,
          (SELECT round(avg(l.optical_dbm)::numeric, 2) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id AND l.created_at >= v_start) AS avg_dbm,
          (SELECT max(l.created_at) FROM public.cablebox_logs l
            WHERE l.cablebox_id = cb.id) AS last_event
      ) s ON true
      WHERE cb.group_id = p_group_id
    ), '[]'::jsonb),
    'blockers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason', b.reason, 'count', b.c) ORDER BY b.c DESC)
      FROM (
        SELECT w.blocker_reason AS reason, count(*) AS c
        FROM public.task_work_logs w
        JOIN public.tasks t ON t.id = w.task_id
        WHERE t.group_id = p_group_id AND w.action = 'blocked'
          AND w.created_at >= v_start AND w.blocker_reason IS NOT NULL
        GROUP BY 1
      ) b
    ), '[]'::jsonb),
    'demo', jsonb_build_object(
      'tasks', (SELECT count(*) FROM public.tasks WHERE group_id = p_group_id AND is_demo),
      'logs', (SELECT count(*) FROM public.cablebox_logs l
                 JOIN public.cableboxes cb ON cb.id = l.cablebox_id
                WHERE cb.group_id = p_group_id AND l.is_demo)
    ),
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6b. report_jobs — the flat list behind the CSV export
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_jobs(
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
  v_days int := LEAST(GREATEST(COALESCE(p_days, 30), 1), 180);
  v_start timestamptz := now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 180) || ' days')::interval;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'You can only read your own group';
  END IF;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'line_number', t.line_number,
        'customer_name', t.customer_name,
        'completed_at', t.completed_at,
        'duration_seconds', t.accumulated_seconds,
        'optical_dbm', t.optical_dbm,
        'port_number', t.port_number,
        'cablebox', COALESCE(cb.box_code, t.cablebox_code_raw),
        'worker', COALESCE(cr.name, u.full_name),
        'task_type', t.task_type,
        'priority', t.priority,
        'is_demo', t.is_demo
      ) ORDER BY t.completed_at DESC)
      FROM public.tasks t
      LEFT JOIN public.cableboxes cb ON cb.id = t.cablebox_id
      LEFT JOIN public.crews cr ON cr.id = t.assigned_crew_id
      LEFT JOIN public.users u ON u.id = t.assigned_user_id
      WHERE t.group_id = p_group_id
        AND t.status = 'completed'
        AND t.completed_at >= v_start
    ), '[]'::jsonb),
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Demo history — flagged, removable, never mixed with real work
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_demo_data(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_tasks int := 0;
  v_logs int := 0;
  v_ports int := 0;
  v_box record;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can manage demo data';
  END IF;

  DELETE FROM public.cablebox_logs l
  USING public.cableboxes cb
  WHERE l.cablebox_id = cb.id AND cb.group_id = v_caller.group_id AND l.is_demo;
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  DELETE FROM public.task_work_logs w
  USING public.tasks t
  WHERE w.task_id = t.id AND t.group_id = v_caller.group_id AND t.is_demo;

  DELETE FROM public.tasks
  WHERE group_id = v_caller.group_id AND is_demo;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  DELETE FROM public.cablebox_ports p
  USING public.cableboxes cb
  WHERE p.cablebox_id = cb.id AND cb.group_id = v_caller.group_id AND p.is_demo;
  GET DIAGNOSTICS v_ports = ROW_COUNT;

  FOR v_box IN SELECT id FROM public.cableboxes WHERE group_id = v_caller.group_id LOOP
    PERFORM public.recompute_box_state(v_box.id);
  END LOOP;

  RETURN jsonb_build_object(
    'removed_tasks', v_tasks,
    'removed_logs', v_logs,
    'removed_ports', v_ports,
    'server_now', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_boxes uuid[];
  v_crews uuid[];
  v_names text[] := ARRAY[
    'AAMINA AXMED FARANSIIS', 'CABDIRAXMAAN AADAN FAARAX', 'HOODA CALI JAAMAC',
    'MAXAMED CABDI XIRSI', 'FADUUMO XASAN NUUR', 'CABDULLAAHI MAXAMUUD AADAN',
    'SAFIYA CUMAR XAAJI', 'XUSEEN CALI WARSAME', 'NASTEHA AXMED CABDI',
    'MARYAN MAXAMED CALI', 'CILMI XASAN FARAAX', 'RUUN CABDI QAASIM'
  ];
  v_i int;
  v_box public.cableboxes;
  v_crew uuid;
  v_task uuid;
  v_port int;
  v_dbm numeric(5,2);
  v_minutes int;
  v_done_at timestamptz;
  v_type text;
  v_duration int;
  v_notes text;
  v_created int := 0;
  v_logs int := 0;
  v_usage record;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can load demo data';
  END IF;
  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'You can only seed your own group';
  END IF;

  -- start clean so the button is idempotent
  PERFORM public.clear_demo_data(p_token);

  SELECT COALESCE(array_agg(id ORDER BY box_code), '{}')
    INTO v_boxes
  FROM public.cableboxes WHERE group_id = p_group_id;

  IF COALESCE(array_length(v_boxes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Add a cablebox before loading demo history';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY name), '{}')
    INTO v_crews
  FROM public.crews WHERE group_id = p_group_id AND is_active = true;

  FOR v_i IN 1..36 LOOP
    SELECT * INTO v_box
    FROM public.cableboxes
    WHERE id = v_boxes[1 + (v_i % array_length(v_boxes, 1))];

    PERFORM public.ensure_box_ports(v_box.id);

    v_crew := CASE
      WHEN COALESCE(array_length(v_crews, 1), 0) = 0 THEN NULL
      ELSE v_crews[1 + (v_i % array_length(v_crews, 1))]
    END;

    v_type := CASE WHEN v_i % 5 = 0 THEN 'installation' ELSE 'cilada' END;
    v_dbm := round((-14 - random() * 15)::numeric, 2);            -- -14 … -29 dBm
    v_duration := 900 + floor(random() * 6300)::int;              -- 15 … 120 min
    v_minutes := floor(random() * 29)::int;                       -- spread over 30 days
    v_done_at := now() - (v_minutes || ' days')::interval - (floor(random() * 9) || ' hours')::interval;

    -- pick a port that is not a known damaged one
    v_port := 1 + floor(random() * v_box.total_ports)::int;
    IF v_port = ANY (v_box.damaged_ports) THEN
      v_port := CASE WHEN v_port < v_box.total_ports THEN v_port + 1 ELSE 1 END;
    END IF;

    v_notes := CASE (v_i % 6)
      WHEN 0 THEN 'Connector re-terminated, dBm acceptable'
      WHEN 1 THEN 'Drop cable replaced at the pole'
      WHEN 2 THEN 'Port cleaned, customer back online'
      WHEN 3 THEN 'Router delivered and tested'
      WHEN 4 THEN 'Splitter pigtail swapped'
      ELSE 'Fault cleared, no further action'
    END;

    INSERT INTO public.tasks (
      group_id, task_type, line_number, customer_name, customer_phone,
      service_type, work_subtype, speed_plan, xaafada,
      cablebox_code_raw, cablebox_id, port_number,
      reported_date, priority, status, is_demo,
      assigned_crew_id, assigned_at,
      accumulated_seconds, optical_dbm, completion_notes,
      completed_at, scheduled_date
    ) VALUES (
      p_group_id, v_type, '9' || lpad(v_i::text, 5, '0'),
      v_names[1 + (v_i % array_length(v_names, 1))],
      '0634' || lpad((100000 + v_i * 137)::text, 6, '0'),
      'Fiber', CASE WHEN v_type = 'installation' THEN 'New install' ELSE 'Fault' END,
      CASE WHEN v_i % 3 = 0 THEN '10 Mbps' ELSE '20 Mbps' END,
      v_box.xaafada,
      v_box.box_code, v_box.id, v_port,
      (v_done_at::date), CASE WHEN v_i % 7 = 0 THEN 'urgent' ELSE 'normal' END,
      'completed', true,
      v_crew, v_done_at - (v_duration || ' seconds')::interval,
      v_duration, v_dbm, v_notes,
      v_done_at, v_done_at::date
    ) RETURNING id INTO v_task;

    v_created := v_created + 1;

    INSERT INTO public.task_work_logs (task_id, user_id, action, session_seconds, optical_dbm, port_number, notes, created_at)
    VALUES (v_task, v_caller.id, 'completed', v_duration, v_dbm, v_port, v_notes, v_done_at);

    -- a share of the jobs hit a blocker first, which feeds the blocker chart
    IF v_i % 4 = 0 THEN
      INSERT INTO public.task_work_logs (task_id, user_id, action, blocker_reason, notes, created_at)
      VALUES (
        v_task, v_caller.id, 'blocked',
        (ARRAY['customer_unreachable', 'fiber_break', 'box_full', 'hardware_defective'])[1 + ((v_i / 4) % 4)],
        NULL, v_done_at - (v_duration || ' seconds')::interval - interval '20 minutes'
      );
    END IF;

    INSERT INTO public.cablebox_logs (
      cablebox_id, task_id, logged_by, event_type, port_number, optical_dbm, notes, created_at, is_demo
    ) VALUES (
      v_box.id, v_task, v_caller.id,
      CASE WHEN v_type = 'installation' THEN 'installation' ELSE 'cilada_fixed' END,
      v_port, v_dbm, v_notes, v_done_at, true
    );
    v_logs := v_logs + 1;

    -- the port is now in use
    INSERT INTO public.cablebox_ports (cablebox_id, port_number, status, line_number, customer_name, is_demo, updated_by)
    VALUES (
      v_box.id, v_port, 'occupied', '9' || lpad(v_i::text, 5, '0'),
      v_names[1 + (v_i % array_length(v_names, 1))], true, v_caller.id
    )
    ON CONFLICT (cablebox_id, port_number) DO UPDATE
      SET status = 'occupied',
          line_number = EXCLUDED.line_number,
          customer_name = EXCLUDED.customer_name,
          is_demo = true
      WHERE public.cablebox_ports.status <> 'damaged';
  END LOOP;

  -- a couple of chronic port failures so the health flags have something to say
  FOR v_usage IN
    SELECT id, total_ports, damaged_ports FROM public.cableboxes WHERE group_id = p_group_id
  LOOP
    INSERT INTO public.cablebox_ports (cablebox_id, port_number, status, notes, is_demo, updated_by)
    VALUES (
      v_usage.id,
      CASE WHEN v_usage.total_ports >= 6 THEN 6 ELSE v_usage.total_ports END,
      'damaged', 'Splitter output dead — swap to another port', true, v_caller.id
    )
    ON CONFLICT (cablebox_id, port_number) DO UPDATE
      SET status = CASE WHEN public.cablebox_ports.status = 'damaged' THEN 'damaged' ELSE 'damaged' END,
          notes = COALESCE(public.cablebox_ports.notes, EXCLUDED.notes),
          is_demo = CASE WHEN public.cablebox_ports.status = 'damaged' THEN public.cablebox_ports.is_demo ELSE true END;

    INSERT INTO public.cablebox_logs (cablebox_id, logged_by, event_type, port_number, notes, created_at, is_demo)
    VALUES (
      v_usage.id, v_caller.id, 'port_damaged',
      CASE WHEN v_usage.total_ports >= 6 THEN 6 ELSE v_usage.total_ports END,
      'Splitter output dead — swap to another port',
      now() - interval '9 days', true
    );

    PERFORM public.recompute_box_state(v_usage.id);
  END LOOP;

  RETURN jsonb_build_object(
    'tasks_created', v_created,
    'logs_created', v_logs,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Permissions
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.box_directory(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.box_detail(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_port_status(uuid, uuid, int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_analytics(uuid, uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_jobs(uuid, uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_demo_data(uuid) TO anon, authenticated;
