-- ----------------------------------------------------------------------------
-- 007 — two defects found while chasing the "technician lands in supervisor"
--       report. Both are server-side; the client fix is in the same PR.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. complete_task wrote the wrong box health.
--
--    The health CASE compared `last_optical_dbm` — the value the UPDATE was
--    about to overwrite — so the reading from the job that just finished was
--    ignored. A box measured at -31 dBm for the first time stayed 'healthy',
--    and a box that improved stayed 'warning' forever.
--
--    Health is already defined in one place (006: recompute_box_state, which
--    reads the newest cablebox_logs reading plus damaged ports and 30-day
--    faults). Call it after the log row is written instead of re-deriving it.
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
    SET fault_count = fault_count + CASE WHEN v_task.task_type = 'cilada' THEN 1 ELSE 0 END,
        updated_at = now()
    WHERE id = v_task.cablebox_id;

    -- Single source of truth: damaged ports + 30-day faults + newest reading.
    PERFORM public.recompute_box_state(v_task.cablebox_id);
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
-- 2. authenticate_pin picked a user without an ORDER BY.
--
--    The identifier can match more than one row (a username equal to another
--    person's phone digits, or the last-7-digits fallback). "LIMIT 1" then
--    returns whichever row Postgres happens to read first — which is how a
--    login can return somebody else's account. Prefer, in order:
--      1. exact username (case-insensitive)
--      2. exact phone digits
--      3. the last-7 suffix match
--    and break remaining ties by creation order, so the result is stable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authenticate_pin(p_identifier text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_id text := lower(trim(p_identifier));
  v_digits text := regexp_replace(p_identifier, '\D', '', 'g');
  v_user public.users;
  v_hash text;
  v_token uuid;
BEGIN
  SELECT u.* INTO v_user
  FROM public.users u
  WHERE u.is_active = true
    AND (
      lower(u.username) = v_clean_id
      OR (v_digits <> '' AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') = v_digits)
      OR (length(v_digits) >= 7 AND right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 7) = right(v_digits, 7))
    )
  ORDER BY
    (lower(u.username) = v_clean_id) DESC,
    (v_digits <> '' AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') = v_digits) DESC,
    u.created_at
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Invalid username/phone or PIN';
  END IF;

  SELECT pin_hash INTO v_hash
  FROM public.user_credentials
  WHERE user_id = v_user.id;

  IF v_hash IS NULL OR v_hash <> extensions.crypt(trim(p_pin), v_hash) THEN
    RAISE EXCEPTION 'Invalid username/phone or PIN';
  END IF;

  INSERT INTO public.user_sessions (user_id)
  VALUES (v_user.id)
  RETURNING token INTO v_token;

  RETURN public.build_auth_payload(v_user.id, v_token);
END;
$$;
