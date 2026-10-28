-- ============================================================================
-- Migration 005 — Technician mobile execution & live timer
--
--   * technician_route: the caller's own jobs (assigned to them personally or to
--     one of their crews) — the technician never sees the whole group.
--   * start_task / block_task / resume_task / complete_task: every action is
--     validated against the assignment, stamped on the server clock and written
--     to task_work_logs, so a duration can never be invented by the phone.
--   * completing a job requires an optical dBm reading and feeds the cablebox
--     history (cablebox_logs) that Phase 5 will present.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper — the caller works this job (personal or crew assignment)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_task_worker(p_user public.users, p_task public.tasks)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- COALESCE is essential: `assigned_user_id = p_user.id` is NULL for a crew
  -- job, and three-valued logic would otherwise leak NULL out of the OR chain.
  SELECT COALESCE(
    p_user.role = 'supervisor'
    OR p_task.assigned_user_id = p_user.id
    OR (
      p_task.assigned_crew_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.crew_members cm
        WHERE cm.crew_id = p_task.assigned_crew_id
          AND cm.user_id = p_user.id
      )
    ),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. technician_route — "my jobs today"
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.technician_route(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_crew_ids uuid[] := '{}';
  v_tasks jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT COALESCE(array_agg(cm.crew_id), '{}')
  INTO v_crew_ids
  FROM public.crew_members cm
  WHERE cm.user_id = v_caller.id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_tasks
  FROM (
    SELECT
      tk.*,
      cb.damaged_ports,
      cb.health_status  AS cablebox_health,
      cb.total_ports    AS cablebox_ports,
      cb.location_notes AS cablebox_notes,
      cb.olt_path       AS cablebox_olt_path,
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'event_type', l.event_type,
              'port_number', l.port_number,
              'notes', l.notes,
              'created_at', l.created_at
            )
            ORDER BY l.created_at DESC
          ),
          '[]'::jsonb
        )
        FROM (
          SELECT *
          FROM public.cablebox_logs
          WHERE cablebox_id = tk.cablebox_id
            AND event_type IN ('port_damaged', 'box_full', 'fiber_break')
          ORDER BY created_at DESC
          LIMIT 3
        ) l
      ) AS box_issues
    FROM public.tasks tk
    LEFT JOIN public.cableboxes cb ON cb.id = tk.cablebox_id
    WHERE tk.group_id = v_caller.group_id
      AND (tk.status <> 'completed' OR tk.completed_at >= CURRENT_DATE)
      AND (
        tk.assigned_user_id = v_caller.id
        OR tk.assigned_crew_id = ANY(v_crew_ids)
      )
    ORDER BY
      CASE tk.status
        WHEN 'in_progress' THEN 0
        WHEN 'blocked' THEN 1
        WHEN 'assigned' THEN 2
        ELSE 3
      END,
      CASE tk.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      tk.reported_date NULLS LAST,
      tk.line_number
  ) t;

  RETURN jsonb_build_object(
    'tasks', v_tasks,
    'crews', to_jsonb(v_crew_ids),
    'server_now', now(),
    'user', jsonb_build_object(
      'id', v_caller.id,
      'full_name', v_caller.full_name,
      'role', v_caller.role
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. start_task
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_task(p_token uuid, p_task_id uuid, p_force boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_others jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'This job is already completed';
  END IF;

  -- Already running (double tap, or the partner started it on the crew phone).
  IF v_task.status = 'in_progress' AND v_task.active_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'task_id', v_task.id,
      'status', 'in_progress',
      'already_running', true,
      'active_started_at', v_task.active_started_at,
      'accumulated_seconds', v_task.accumulated_seconds,
      'server_now', now()
    );
  END IF;

  -- Several open timers are allowed, but the technician must be told.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'line_number', t.line_number, 'customer_name', t.customer_name)), '[]'::jsonb)
  INTO v_others
  FROM public.tasks t
  WHERE t.group_id = v_caller.group_id
    AND t.status = 'in_progress'
    AND t.id <> v_task.id
    AND (t.assigned_user_id = v_caller.id OR t.assigned_crew_id = ANY(
      SELECT cm.crew_id FROM public.crew_members cm WHERE cm.user_id = v_caller.id
    ));

  IF jsonb_array_length(v_others) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'task_id', v_task.id,
      'status', v_task.status,
      'needs_confirmation', true,
      'other_running', v_others,
      'server_now', now()
    );
  END IF;

  UPDATE public.tasks
  SET status = 'in_progress',
      active_started_at = now(),
      active_started_by = v_caller.id,
      blocker_reason = NULL,
      blocker_notes = NULL,
      blocked_at = NULL,
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (v_task.id, v_caller.id, 'started', 'Timer started');

  RETURN jsonb_build_object(
    'task_id', v_task.id,
    'status', 'in_progress',
    'already_running', false,
    'active_started_at', now(),
    'accumulated_seconds', v_task.accumulated_seconds,
    'other_running', v_others,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. block_task — the clock stops, the job stays open as Blocked
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_task(
  p_token uuid,
  p_task_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_session int := 0;
  v_total int;
  v_event text;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  IF p_reason NOT IN ('customer_unreachable', 'fiber_break', 'box_full', 'hardware_defective', 'other') THEN
    RAISE EXCEPTION 'Unknown blocker reason: %', p_reason;
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'This job is already completed';
  END IF;

  IF v_task.active_started_at IS NOT NULL THEN
    v_session := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_task.active_started_at))::int);
  END IF;

  v_total := v_task.accumulated_seconds + v_session;

  UPDATE public.tasks
  SET status = 'blocked',
      accumulated_seconds = v_total,
      active_started_at = NULL,
      blocker_reason = p_reason,
      blocker_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
      blocked_at = now(),
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, session_seconds, blocker_reason, notes)
  VALUES (v_task.id, v_caller.id, 'blocked', v_session, p_reason, NULLIF(btrim(COALESCE(p_notes, '')), ''));

  -- Infrastructure data for the cablebox history (Phase 5).
  IF v_task.cablebox_id IS NOT NULL THEN
    v_event := CASE p_reason
      WHEN 'fiber_break' THEN 'fiber_break'
      WHEN 'box_full' THEN 'box_full'
      ELSE NULL
    END;

    IF v_event IS NOT NULL THEN
      INSERT INTO public.cablebox_logs (cablebox_id, task_id, logged_by, event_type, port_number, notes)
      VALUES (v_task.cablebox_id, v_task.id, v_caller.id, v_event, v_task.port_number, p_notes);

      UPDATE public.cableboxes
      SET health_status = CASE WHEN p_reason = 'box_full' THEN 'critical' ELSE 'warning' END,
          fault_count = fault_count + 1,
          updated_at = now()
      WHERE id = v_task.cablebox_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'task_id', v_task.id,
    'status', 'blocked',
    'session_seconds', v_session,
    'accumulated_seconds', v_total,
    'reason', p_reason,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. resume_task — clear the blocker, restart the clock, keep the total
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resume_task(p_token uuid, p_task_id uuid)
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

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'This job is already completed';
  END IF;

  UPDATE public.tasks
  SET status = 'in_progress',
      active_started_at = now(),
      blocker_reason = NULL,
      blocker_notes = NULL,
      blocked_at = NULL,
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (v_task.id, v_caller.id, 'resumed', 'Timer resumed');

  RETURN jsonb_build_object(
    'task_id', v_task.id,
    'status', 'in_progress',
    'active_started_at', now(),
    'accumulated_seconds', v_task.accumulated_seconds,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. complete_task — dBm is mandatory, duration is final
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task(
  p_token uuid,
  p_task_id uuid,
  p_dbm numeric,
  p_notes text DEFAULT NULL,
  p_port_number int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_session int := 0;
  v_total int;
  v_dbm numeric(5,2);
  v_event text;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'This job is already completed';
  END IF;

  IF p_dbm IS NULL THEN
    RAISE EXCEPTION 'An optical dBm reading is required to complete a job';
  END IF;

  IF p_dbm > 0 OR p_dbm < -40 THEN
    RAISE EXCEPTION 'dBm reading % is outside the measurable range (-40 … 0)', p_dbm;
  END IF;

  v_dbm := round(p_dbm, 2);

  IF v_task.active_started_at IS NOT NULL THEN
    v_session := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_task.active_started_at))::int);
  END IF;

  v_total := v_task.accumulated_seconds + v_session;

  UPDATE public.tasks
  SET status = 'completed',
      accumulated_seconds = v_total,
      active_started_at = NULL,
      blocker_reason = NULL,
      blocked_at = NULL,
      optical_dbm = v_dbm,
      completion_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
      port_number = COALESCE(p_port_number, port_number),
      completed_at = now(),
      completed_by = v_caller.id,
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (
    task_id, user_id, action, session_seconds, optical_dbm, port_number, notes
  ) VALUES (
    v_task.id, v_caller.id, 'completed', v_session, v_dbm,
    COALESCE(p_port_number, v_task.port_number),
    NULLIF(btrim(COALESCE(p_notes, '')), '')
  );

  IF v_task.cablebox_id IS NOT NULL THEN
    v_event := CASE WHEN v_task.task_type = 'installation' THEN 'installation' ELSE 'cilada_fixed' END;

    INSERT INTO public.cablebox_logs (
      cablebox_id, task_id, logged_by, event_type, port_number, optical_dbm, notes
    ) VALUES (
      v_task.cablebox_id, v_task.id, v_caller.id, v_event,
      COALESCE(p_port_number, v_task.port_number), v_dbm,
      NULLIF(btrim(COALESCE(p_notes, '')), '')
    );

    UPDATE public.cableboxes
    SET last_optical_dbm = v_dbm,
        fault_count = fault_count + CASE WHEN v_task.task_type = 'cilada' THEN 1 ELSE 0 END,
        health_status = CASE
          WHEN health_status = 'critical' THEN 'critical'
          WHEN last_optical_dbm IS NOT NULL AND last_optical_dbm < -27 THEN 'warning'
          ELSE health_status
        END,
        updated_at = now()
    WHERE id = v_task.cablebox_id;
  END IF;

  RETURN jsonb_build_object(
    'task_id', v_task.id,
    'status', 'completed',
    'duration_seconds', v_total,
    'session_seconds', v_session,
    'optical_dbm', v_dbm,
    'completed_at', now(),
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. live_status — what the supervisor sees while the crews are out
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_status(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_rows jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.started_at), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      tk.id,
      tk.line_number,
      tk.customer_name,
      tk.cablebox_code_raw,
      tk.xaafada,
      tk.status,
      tk.active_started_at AS started_at,
      tk.accumulated_seconds,
      tk.blocker_reason,
      tk.priority,
      COALESCE(cr.name, u.full_name) AS worker_name,
      CASE WHEN cr.id IS NOT NULL THEN 'crew' ELSE 'user' END AS worker_kind
    FROM public.tasks tk
    LEFT JOIN public.crews cr ON cr.id = tk.assigned_crew_id
    LEFT JOIN public.users u ON u.id = tk.assigned_user_id
    WHERE tk.group_id = p_group_id
      AND tk.status IN ('in_progress', 'blocked')
  ) t;

  RETURN jsonb_build_object('rows', v_rows, 'server_now', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.technician_route(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_task(uuid, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_task(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_task(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, uuid, numeric, text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_status(uuid, uuid) TO anon, authenticated;
