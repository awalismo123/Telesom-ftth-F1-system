-- ============================================================================
-- Migration 009 — Batch E (2/3): the two things the field could not do
--
--   * upsert_cablebox: register or edit a box from the field, with duplicate
--     detection that returns the existing box instead of creating a twin.
--   * create_manual_task: a phone-in job — customer, line, box, port, urgency —
--     with the importer's rule: never silently create a second open job.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3. upsert_cablebox — register or edit a box from the field
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_cablebox(
  p_token uuid,
  p_group_id uuid,
  p_box_id uuid DEFAULT NULL,
  p_box_code text DEFAULT NULL,
  p_xaafada text DEFAULT NULL,
  p_olt_path text DEFAULT NULL,
  p_total_ports int DEFAULT 8,
  p_location_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_code text;
  v_existing public.cableboxes;
  v_box public.cableboxes;
  v_busy int;
  v_mode text;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  -- Same normalisation the importer uses, so "fat 48" and "FAT 48" are one box.
  v_code := upper(regexp_replace(btrim(COALESCE(p_box_code, '')), '\s+', ' ', 'g'));

  IF v_code = '' THEN
    RAISE EXCEPTION 'A cablebox code is required';
  END IF;

  IF length(v_code) > 24 THEN
    RAISE EXCEPTION 'That cablebox code is too long (24 characters maximum)';
  END IF;

  IF p_total_ports NOT IN (4, 8, 12, 16, 24, 32) THEN
    RAISE EXCEPTION 'Ports must be 4, 8, 12, 16, 24 or 32';
  END IF;

  SELECT * INTO v_existing FROM public.cableboxes WHERE box_code = v_code LIMIT 1;

  -- Duplicate detection: never create a twin. Hand the existing box back to the
  -- screen so it can offer "open it" or "edit it" instead of failing on a
  -- unique constraint nobody can read.
  IF v_existing.id IS NOT NULL AND (p_box_id IS NULL OR v_existing.id <> p_box_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'duplicate',
      'box', jsonb_build_object(
        'id', v_existing.id,
        'group_id', v_existing.group_id,
        'box_code', v_existing.box_code,
        'xaafada', v_existing.xaafada,
        'olt_path', v_existing.olt_path,
        'total_ports', v_existing.total_ports,
        'health_status', v_existing.health_status
      )
    );
  END IF;

  IF p_box_id IS NULL THEN
    INSERT INTO public.cableboxes (
      group_id, box_code, xaafada, olt_path, total_ports, location_notes, health_status
    )
    VALUES (
      p_group_id,
      v_code,
      NULLIF(btrim(COALESCE(p_xaafada, '')), ''),
      NULLIF(btrim(COALESCE(p_olt_path, '')), ''),
      p_total_ports,
      NULLIF(btrim(COALESCE(p_location_notes, '')), ''),
      'healthy'
    )
    RETURNING * INTO v_box;

    PERFORM public.ensure_box_ports(v_box.id);

    INSERT INTO public.cablebox_logs (cablebox_id, logged_by, event_type, notes)
    VALUES (v_box.id, v_caller.id, 'note', 'Box registered by ' || v_caller.full_name);

    v_mode := 'created';
  ELSE
    SELECT * INTO v_box FROM public.cableboxes WHERE id = p_box_id FOR UPDATE;

    IF v_box.id IS NULL THEN
      RAISE EXCEPTION 'Cablebox not found';
    END IF;

    IF v_box.group_id IS DISTINCT FROM p_group_id THEN
      RAISE EXCEPTION 'This cablebox belongs to another group';
    END IF;

    -- Shrinking is allowed only when the ports being dropped are empty. Losing
    -- an occupied or damaged port would lose the customer's line.
    IF p_total_ports < v_box.total_ports THEN
      SELECT count(*) INTO v_busy
      FROM public.cablebox_ports
      WHERE cablebox_id = v_box.id
        AND port_number > p_total_ports
        AND status IN ('occupied', 'damaged', 'reserved');

      IF v_busy > 0 THEN
        RAISE EXCEPTION
          'Cannot shrink to % ports: % port(s) above that are in use, damaged or reserved',
          p_total_ports, v_busy;
      END IF;

      DELETE FROM public.cablebox_ports
      WHERE cablebox_id = v_box.id AND port_number > p_total_ports;
    END IF;

    UPDATE public.cableboxes
    SET box_code = v_code,
        xaafada = NULLIF(btrim(COALESCE(p_xaafada, '')), ''),
        olt_path = NULLIF(btrim(COALESCE(p_olt_path, '')), ''),
        total_ports = p_total_ports,
        location_notes = NULLIF(btrim(COALESCE(p_location_notes, '')), ''),
        updated_at = now()
    WHERE id = v_box.id;

    PERFORM public.ensure_box_ports(v_box.id);
    PERFORM public.recompute_box_state(v_box.id);

    SELECT * INTO v_box FROM public.cableboxes WHERE id = p_box_id;

    INSERT INTO public.cablebox_logs (cablebox_id, logged_by, event_type, notes)
    VALUES (
      v_box.id,
      v_caller.id,
      'note',
      'Details updated by ' || v_caller.full_name || ': '
        || v_box.box_code || ' · ' || v_box.total_ports || ' ports'
        || COALESCE(' · ' || v_box.xaafada, '')
    );

    v_mode := 'updated';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', v_mode,
    'box', jsonb_build_object(
      'id', v_box.id,
      'group_id', v_box.group_id,
      'box_code', v_box.box_code,
      'xaafada', v_box.xaafada,
      'olt_path', v_box.olt_path,
      'total_ports', v_box.total_ports,
      'health_status', v_box.health_status,
      'location_notes', v_box.location_notes,
      'ports_used', (SELECT count(*) FROM public.cablebox_ports p
                      WHERE p.cablebox_id = v_box.id AND p.status = 'occupied'),
      'ports_damaged', (SELECT count(*) FROM public.cablebox_ports p
                         WHERE p.cablebox_id = v_box.id AND p.status = 'damaged'),
      'server_now', now()
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. create_manual_task — the phone call, captured while it is happening
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_task(
  p_token uuid,
  p_group_id uuid,
  p_payload jsonb,
  p_allow_duplicate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_line text;
  v_name text;
  v_type text;
  v_priority text;
  v_box_code text;
  v_box_id uuid;
  v_port int;
  v_box_ports int;
  v_task public.tasks;
  v_dup public.tasks;
  v_user_id uuid;
  v_crew_id uuid;
  v_status text := 'unassigned';
  v_label text;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can add a job';
  END IF;

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_line := btrim(COALESCE(p_payload->>'line_number', ''));
  v_name := btrim(COALESCE(p_payload->>'customer_name', ''));
  v_type := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'task_type', '')), ''), 'cilada');
  v_priority := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'priority', '')), ''), 'normal');
  v_box_code := btrim(COALESCE(p_payload->>'box_code', ''));

  IF v_line = '' THEN
    RAISE EXCEPTION 'A line number is required';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'A customer name is required';
  END IF;

  IF v_type NOT IN ('installation', 'cilada') THEN
    RAISE EXCEPTION 'Job type must be installation or cilada';
  END IF;

  IF v_priority NOT IN ('normal', 'urgent') THEN
    RAISE EXCEPTION 'Priority must be normal or urgent';
  END IF;

  v_port := NULL;
  IF NULLIF(btrim(COALESCE(p_payload->>'port_number', '')), '') IS NOT NULL THEN
    BEGIN
      v_port := (p_payload->>'port_number')::int;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Port must be a number';
    END;
    IF v_port < 1 OR v_port > 32 THEN
      RAISE EXCEPTION 'Port must be between 1 and 32';
    END IF;
  END IF;

  -- Same rule as the importer: there is already an open job for this line.
  -- Return it; the supervisor confirms before a second one is created.
  SELECT * INTO v_dup
  FROM public.tasks
  WHERE group_id = p_group_id
    AND task_type = v_type
    AND lower(btrim(line_number)) = lower(v_line)
    AND status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_dup.id IS NOT NULL AND NOT p_allow_duplicate THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'duplicate',
      'task', jsonb_build_object(
        'id', v_dup.id,
        'line_number', v_dup.line_number,
        'customer_name', v_dup.customer_name,
        'status', v_dup.status,
        'task_type', v_dup.task_type,
        'created_at', v_dup.created_at
      )
    );
  END IF;

  IF v_box_code <> '' THEN
    v_box_id := public.ensure_cablebox(
      p_group_id,
      v_box_code,
      NULLIF(btrim(COALESCE(p_payload->>'xaafada', '')), ''),
      NULL
    );

    -- A port that does not exist on that box is a typo, not a job.
    IF v_port IS NOT NULL THEN
      SELECT total_ports INTO v_box_ports FROM public.cableboxes WHERE id = v_box_id;

      IF v_port > v_box_ports THEN
        RAISE EXCEPTION 'Cablebox % has only % ports', v_box_code, v_box_ports;
      END IF;
    END IF;
  END IF;

  v_user_id := NULLIF(btrim(COALESCE(p_payload->>'assign_user_id', '')), '')::uuid;
  v_crew_id := NULLIF(btrim(COALESCE(p_payload->>'assign_crew_id', '')), '')::uuid;

  IF v_user_id IS NOT NULL AND v_crew_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one technician or one crew, not both';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT full_name INTO v_label
    FROM public.users
    WHERE id = v_user_id AND group_id = p_group_id AND is_active = true;
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Technician not found in this group';
    END IF;
    v_status := 'assigned';
  ELSIF v_crew_id IS NOT NULL THEN
    SELECT name INTO v_label
    FROM public.crews
    WHERE id = v_crew_id AND group_id = p_group_id AND is_active = true;
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Crew not found in this group';
    END IF;
    v_status := 'assigned';
  END IF;

  INSERT INTO public.tasks (
    group_id, task_type, line_number, customer_name, customer_phone, x_number,
    complain_type, service_type, work_subtype, speed_plan, xaafada,
    cablebox_code_raw, cablebox_id, port_number,
    reported_date, reported_time, priority, is_urgent,
    status, scheduled_date, last_seen_on_sheet_date,
    source, created_by, intake_notes,
    assigned_user_id, assigned_crew_id, assigned_by, assigned_at
  )
  VALUES (
    p_group_id,
    v_type,
    v_line,
    v_name,
    NULLIF(btrim(COALESCE(p_payload->>'customer_phone', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'x_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'complain_type', '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'service_type', '')), ''), 'Fiber'),
    NULLIF(btrim(COALESCE(p_payload->>'work_subtype', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'speed_plan', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'xaafada', '')), ''),
    NULLIF(v_box_code, ''),
    v_box_id,
    v_port,
    CURRENT_DATE,
    to_char(now(), 'HH24:MI'),
    v_priority,
    (v_priority = 'urgent'),
    v_status,
    CURRENT_DATE,
    CURRENT_DATE,
    'manual',
    v_caller.id,
    NULLIF(btrim(COALESCE(p_payload->>'notes', '')), ''),
    v_user_id,
    v_crew_id,
    CASE WHEN v_status = 'assigned' THEN v_caller.id ELSE NULL END,
    CASE WHEN v_status = 'assigned' THEN now() ELSE NULL END
  )
  RETURNING * INTO v_task;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (
    v_task.id,
    v_caller.id,
    'imported',
    'Phone-in job added by ' || v_caller.full_name
      || COALESCE(' — ' || v_task.intake_notes, '')
  );

  IF v_status = 'assigned' THEN
    INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
    VALUES (v_task.id, v_caller.id, 'assigned', v_label || ' (on the phone)');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'created',
    'task', row_to_json(v_task),
    'assigned_to', v_label,
    'server_now', now()
  );
END;
$$;
