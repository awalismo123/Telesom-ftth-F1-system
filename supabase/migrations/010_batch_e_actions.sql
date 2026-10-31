-- ============================================================================
-- Migration 010 — Batch E (3/3): corrections, search, and the technician's view
--
--   * cancel_task / reopen_task: the two actions a supervisor does most often
--     after a customer calls back.
--   * global_search: one query across lines, customers, phones, boxes, areas.
--   * technician_route: a cancelled job never appears on a phone.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5. cancel_task — with a reason, always audited
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_task(
  p_token uuid,
  p_task_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_reason text;
  v_session int := 0;
  v_total int;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can cancel a job';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF v_task.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'task_id', v_task.id, 'status', 'cancelled', 'already', true);
  END IF;

  IF v_task.status = 'completed' THEN
    RAISE EXCEPTION 'This job is already completed. Reopen it first if it must be cancelled.';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));

  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason is required to cancel a job';
  END IF;

  -- A running job is still running: fold the clock so the time on site is not
  -- lost, then stop it.
  IF v_task.active_started_at IS NOT NULL THEN
    v_session := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_task.active_started_at))::int);
  END IF;

  v_total := v_task.accumulated_seconds + v_session;

  UPDATE public.tasks
  SET status = 'cancelled',
      accumulated_seconds = v_total,
      active_started_at = NULL,
      blocked_at = NULL,
      cancelled_at = now(),
      cancelled_by = v_caller.id,
      cancel_reason = v_reason,
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, session_seconds, notes)
  VALUES (v_task.id, v_caller.id, 'cancelled', v_session, v_reason);

  RETURN jsonb_build_object(
    'ok', true,
    'task_id', v_task.id,
    'status', 'cancelled',
    'accumulated_seconds', v_total,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. reopen_task — the customer called back
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_task(
  p_token uuid,
  p_task_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_new_status text;
  v_previous_seconds int;
  v_previous_status text;
  v_note text;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can reopen a job';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;

  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF v_task.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only completed or cancelled jobs can be reopened';
  END IF;

  v_previous_status := v_task.status;
  v_previous_seconds := v_task.accumulated_seconds;

  -- Stays with the same technician or crew, unless it was never assigned.
  v_new_status := CASE
    WHEN v_task.assigned_user_id IS NOT NULL OR v_task.assigned_crew_id IS NOT NULL THEN 'assigned'
    ELSE 'unassigned'
  END;

  v_note := 'Reopened from ' || v_previous_status
    || CASE
         WHEN v_task.optical_dbm IS NOT NULL THEN ' · previous reading ' || v_task.optical_dbm || ' dBm'
         ELSE ''
       END
    || COALESCE(' · ' || NULLIF(btrim(COALESCE(p_reason, '')), ''), '');

  PERFORM set_config('f1.allow_reopen', 'on', true);

  UPDATE public.tasks
  SET status = v_new_status,
      accumulated_seconds = 0,
      active_started_at = NULL,
      active_started_by = NULL,
      completed_at = NULL,
      completed_by = NULL,
      cancelled_at = NULL,
      cancelled_by = NULL,
      cancel_reason = NULL,
      blocker_reason = NULL,
      blocker_notes = NULL,
      blocked_at = NULL,
      optical_dbm = NULL,
      completion_notes = NULL,
      reopened_count = v_task.reopened_count + 1,
      last_reopened_at = now(),
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, session_seconds, notes)
  VALUES (v_task.id, v_caller.id, 'reopened', v_previous_seconds, v_note);

  RETURN jsonb_build_object(
    'ok', true,
    'task_id', v_task.id,
    'status', v_new_status,
    'previous_status', v_previous_status,
    'reopened_count', v_task.reopened_count + 1,
    'server_now', now()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. global_search — line, customer, phone, box, area
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.global_search(
  p_token uuid,
  p_group_id uuid,
  p_query text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_q text;
  v_like text;
  v_digits text;
  v_tasks jsonb;
  v_boxes jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_q := lower(btrim(COALESCE(p_query, '')));

  IF length(v_q) < 2 THEN
    RETURN jsonb_build_object('tasks', '[]'::jsonb, 'boxes', '[]'::jsonb, 'query', v_q);
  END IF;

  v_like := '%' || v_q || '%';
  v_digits := regexp_replace(v_q, '\D', '', 'g');

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.rank, t.sort_at DESC), '[]'::jsonb)
  INTO v_tasks
  FROM (
    SELECT
      tk.id,
      tk.line_number,
      tk.customer_name,
      tk.customer_phone,
      tk.xaafada,
      tk.cablebox_code_raw,
      tk.port_number,
      tk.status,
      tk.task_type,
      tk.priority,
      tk.assigned_at,
      COALESCE(cr.name, u.full_name) AS worker,
      COALESCE(tk.completed_at, tk.assigned_at, tk.created_at) AS sort_at,
      CASE
        WHEN lower(tk.line_number) = v_q THEN 0
        WHEN lower(tk.line_number) LIKE v_q || '%' THEN 1
        WHEN v_digits <> '' AND regexp_replace(COALESCE(tk.customer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%' THEN 2
        WHEN lower(tk.customer_name) LIKE v_q || '%' THEN 3
        WHEN lower(COALESCE(tk.cablebox_code_raw, '')) LIKE v_q || '%' THEN 4
        WHEN lower(COALESCE(tk.xaafada, '')) LIKE v_q || '%' THEN 5
        ELSE 6
      END AS rank
    FROM public.tasks tk
    LEFT JOIN public.crews cr ON cr.id = tk.assigned_crew_id
    LEFT JOIN public.users u ON u.id = tk.assigned_user_id
    WHERE tk.group_id = p_group_id
      AND (
        lower(tk.line_number) LIKE v_like
        OR lower(tk.customer_name) LIKE v_like
        OR lower(COALESCE(tk.customer_phone, '')) LIKE v_like
        OR (v_digits <> '' AND regexp_replace(COALESCE(tk.customer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
        OR lower(COALESCE(tk.cablebox_code_raw, '')) LIKE v_like
        OR lower(COALESCE(tk.xaafada, '')) LIKE v_like
      )
    ORDER BY rank, sort_at DESC
    LIMIT 8
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.rank, b.box_code), '[]'::jsonb)
  INTO v_boxes
  FROM (
    SELECT
      cb.id,
      cb.box_code,
      cb.xaafada,
      cb.olt_path,
      cb.total_ports,
      cb.health_status,
      (SELECT count(*) FROM public.cablebox_ports p
        WHERE p.cablebox_id = cb.id AND p.status = 'damaged') AS ports_damaged,
      CASE
        WHEN lower(cb.box_code) = v_q THEN 0
        WHEN lower(cb.box_code) LIKE v_q || '%' THEN 1
        ELSE 2
      END AS rank
    FROM public.cableboxes cb
    WHERE cb.group_id = p_group_id
      AND (
        lower(cb.box_code) LIKE v_like
        OR lower(COALESCE(cb.xaafada, '')) LIKE v_like
        OR lower(COALESCE(cb.olt_path, '')) LIKE v_like
      )
    ORDER BY rank, cb.box_code
    LIMIT 5
  ) b;

  RETURN jsonb_build_object('tasks', v_tasks, 'boxes', v_boxes, 'query', v_q);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. technician_route — a cancelled job must not appear on anyone's phone
--    (redefined from 005 with one extra filter)
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
      AND tk.status <> 'cancelled'
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

GRANT EXECUTE ON FUNCTION public.upsert_cablebox(uuid, uuid, uuid, text, text, text, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_task(uuid, uuid, jsonb, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_task(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_task(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.technician_route(uuid) TO anon, authenticated;
