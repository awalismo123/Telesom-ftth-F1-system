-- ============================================================================
-- 034 — taking somebody off duty must not hide their work
-- ============================================================================
--
-- `dispatch_load` builds the board's lanes from technicians and crews where
-- `is_active = true`. `upsert_team_member` and `upsert_crew` set `is_active`
-- from the form and check nothing else.
--
-- Put together, deactivating a person or retiring a crew **removes their open
-- jobs from the board** while leaving them `assigned` in the database. The job is
-- still somebody's responsibility, still counted by `today_summary` as work in
-- hand, and visible on no lane — so no supervisor can see that it needs moving.
--
-- Measured on the live project on 24/11/2026, in rolled-back transactions:
--
--   * deactivating `cabdi` while he held 2 assigned jobs: succeeded, said nothing
--   * retiring `F1 - Crew A` while it held 2 assigned jobs: succeeded, said nothing
--
-- Both would have been discovered as missing work at the end of a shift.
--
-- ----------------------------------------------------------------------------
-- What this does
-- ----------------------------------------------------------------------------
--   1. `upsert_team_member` refuses to set `is_active = false` while the person
--      holds a job that is `assigned`, `in_progress` or `blocked`.
--   2. `upsert_crew` refuses the same for a crew.
--   3. `team_workload` returns the held jobs per person and per crew, so the
--      screen can say which ones and refuse the click before the round trip.
--
-- A job in progress gets its own message: somebody is at the customer's house,
-- and that is a different situation from a job waiting to be picked up.
--
-- ----------------------------------------------------------------------------
-- Deliberately NOT done
-- ----------------------------------------------------------------------------
-- No reassignment is performed on the supervisor's behalf. Choosing who inherits
-- two faults is a dispatch decision with a cost attached, made by somebody
-- looking at a shift rather than at a roster. The rule is: move the work, then
-- retire the person — in that order, decided by a supervisor.
--
-- Deleting a user is already impossible: every reference to `users` from tasks,
-- logs, photos, materials, batches and sessions is `NO ACTION`, so history
-- cannot be destroyed this way. This migration concerns retirement, not deletion.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Who is holding what
-- ----------------------------------------------------------------------------
-- One row per open job, with the person and crew responsible. Both columns are
-- returned because a job can be assigned to a crew *and* carry `assigned_user_id`
-- from an earlier individual assignment; the board treats those separately.
CREATE OR REPLACE FUNCTION public.team_workload(
  p_token uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
  v_jobs jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can read the roster workload';
  END IF;

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(j) ORDER BY j.line_number), '[]'::jsonb)
  INTO v_jobs
  FROM (
    SELECT
      t.id,
      t.line_number,
      t.customer_name,
      t.status,
      t.task_type,
      t.assigned_user_id,
      t.assigned_crew_id
    FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('assigned', 'in_progress', 'blocked')
      AND (t.assigned_user_id IS NOT NULL OR t.assigned_crew_id IS NOT NULL)
  ) j;

  RETURN jsonb_build_object('jobs', v_jobs);
END;
$function$;

COMMENT ON FUNCTION public.team_workload(uuid, uuid) IS
  'Open jobs per person and per crew, so the roster can refuse to hide them. Read-only; reads the same rows dispatch_load would stop showing.';

GRANT EXECUTE ON FUNCTION public.team_workload(uuid, uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. A person cannot go off duty holding work
-- ----------------------------------------------------------------------------
-- The body is the previous definition with one guard inserted before the UPDATE.
-- Everything else — the role check, the username normalisation, the PIN handling
-- and the bcrypt salt — is unchanged, because rewriting a credential path to add
-- a work check is how passwords get broken.
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
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
  v_target_id uuid;
  v_clean_username text := lower(regexp_replace(trim(p_username), '\s+', '_', 'g'));
  v_clean_phone text := NULLIF(trim(COALESCE(p_phone, '')), '');
  v_held int;
  v_active int;
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
    -- Going off duty is only allowed with an empty hand. `dispatch_load` stops
    -- showing an inactive technician, so their assigned jobs would leave every
    -- lane while staying assigned — invisible work, which is the failure this
    -- whole function exists to prevent.
    IF p_is_active IS FALSE THEN
      SELECT count(*), count(*) FILTER (WHERE status IN ('in_progress', 'blocked'))
      INTO v_held, v_active
      FROM public.tasks
      WHERE assigned_user_id = p_member_id
        AND group_id = p_group_id
        AND status IN ('assigned', 'in_progress', 'blocked');

      IF v_active > 0 THEN
        RAISE EXCEPTION
          'This job is being worked on right now. It cannot be taken off the board while somebody is at the customer.'
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_held > 0 THEN
        RAISE EXCEPTION
          '% job(s) are still assigned to this person. Move them to somebody else, then take them off duty.',
          v_held
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

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

      UPDATE public.users SET must_change_pin = true WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN v_target_id;
END;
$function$;

COMMENT ON FUNCTION public.upsert_team_member(uuid, uuid, uuid, text, text, text, text, text, boolean) IS
  'Create or edit a team member. Refuses to deactivate somebody holding open work, because dispatch_load would stop showing those jobs.';

-- ----------------------------------------------------------------------------
-- 3. A crew cannot be retired holding work
-- ----------------------------------------------------------------------------
-- Same guard, same reason: the crew's jobs are counted by `assigned_crew_id` and
-- disappear from the board when `is_active` goes false.
CREATE OR REPLACE FUNCTION public.upsert_crew(
  p_token uuid,
  p_crew_id uuid,
  p_group_id uuid,
  p_name text,
  p_vehicle_tag text,
  p_zone_focus text,
  p_member_ids uuid[],
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
  v_target_crew_id uuid;
  v_uid uuid;
  v_members int;
  v_held int;
  v_active int;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage crews';
  END IF;

  v_members := coalesce(array_length(p_member_ids, 1), 0);

  IF v_members > 2 THEN
    RAISE EXCEPTION 'A crew is one or two people, not %.', v_members USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_active AND v_members = 0 THEN
    RAISE EXCEPTION 'An active crew needs at least one member. Add a technician, or mark the crew inactive.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A crew saved as active with somebody off duty in it reads as a staffed
  -- vehicle on the roster and on the board, while half of it cannot take a job.
  -- An *inactive* crew may hold inactive people: that is retirement, and
  -- refusing it would make retiring a crew and its roster impossible in order.
  IF p_is_active AND v_members > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = ANY(p_member_ids) AND u.is_active = false
    ) THEN
      RAISE EXCEPTION
        'Somebody in this crew is off duty. Re-activate them first, or save the crew as inactive.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_crew_id IS NULL THEN
    INSERT INTO public.crews (group_id, name, vehicle_tag, zone_focus, is_active)
    VALUES (
      p_group_id,
      trim(p_name),
      NULLIF(trim(COALESCE(p_vehicle_tag, '')), ''),
      NULLIF(trim(COALESCE(p_zone_focus, '')), ''),
      p_is_active
    )
    RETURNING id INTO v_target_crew_id;
  ELSE
    IF p_is_active IS FALSE THEN
      SELECT count(*), count(*) FILTER (WHERE status IN ('in_progress', 'blocked'))
      INTO v_held, v_active
      FROM public.tasks
      WHERE assigned_crew_id = p_crew_id
        AND group_id = p_group_id
        AND status IN ('assigned', 'in_progress', 'blocked');

      IF v_active > 0 THEN
        RAISE EXCEPTION
          'This crew is working on a job right now. It cannot be taken off the board while somebody is at the customer.'
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_held > 0 THEN
        RAISE EXCEPTION
          '% job(s) are still assigned to this crew. Move them to somebody else, then take the crew off duty.',
          v_held
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    UPDATE public.crews
    SET name = trim(p_name),
        vehicle_tag = NULLIF(trim(COALESCE(p_vehicle_tag, '')), ''),
        zone_focus = NULLIF(trim(COALESCE(p_zone_focus, '')), ''),
        is_active = p_is_active
    WHERE id = p_crew_id
    RETURNING id INTO v_target_crew_id;
  END IF;

  DELETE FROM public.crew_members WHERE crew_id = v_target_crew_id;

  IF p_member_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_member_ids LOOP
      INSERT INTO public.crew_members (crew_id, user_id)
      VALUES (v_target_crew_id, v_uid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_target_crew_id;
END;
$function$;

COMMENT ON FUNCTION public.upsert_crew(uuid, uuid, uuid, text, text, text, uuid[], boolean) IS
  'Create or edit a crew. Caps at two people, refuses an empty active crew, and refuses to retire a crew holding open work.';

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- Restores the previous definitions from 023 (crew) and 014 (member), which have
-- no work guard, and drops the read.
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.team_workload(uuid, uuid);
--
--   -- Re-apply 023's upsert_crew and 014's upsert_team_member verbatim here.
--   -- They are intentionally not duplicated in this file: a rollback that
--   -- restores a copy risks restoring a stale copy.
-- COMMIT;
