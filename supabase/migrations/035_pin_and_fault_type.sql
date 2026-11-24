-- ============================================================================
-- 035 — a supervisor-set PIN that works, and a fault type that means something
-- ============================================================================
--
-- Five separate faults, all found by exercising the live project on 24/11/2026
-- rather than by reading the code. The first three are the PIN. The last two are
-- the fault type: a column already imported but never constrained, and a bulk
-- edit sheet whose default silently wrote a fault type nobody chose.
--
-- ----------------------------------------------------------------------------
-- 1. A supervisor-set PIN did not unlock a locked account
-- ----------------------------------------------------------------------------
-- `authenticate_pin` locks an account for 15 minutes after five wrong PINs.
-- `upsert_team_member` writes a new hash and clears nothing else. So the
-- sequence a supervisor actually performs — "he cannot get in, give him a new
-- PIN" — produces a correct new hash on an account that still refuses to sign in
-- until the lock expires, with nothing on any screen explaining why.
--
-- Verified live: after `upsert_team_member` set a PIN, `authenticate_pin`
-- returned `{"ok": false, "reason": "locked"}` for the new PIN, which was
-- otherwise correct.
--
-- Setting a PIN now clears `failed_attempts` and `locked_until`, because a new
-- credential is a new start: the lock exists to slow down guessing, and the
-- supervisor who issues a PIN has already established who the person is.
--
-- ----------------------------------------------------------------------------
-- 2. The "Department PINs still in use" banner could never be cleared
-- ----------------------------------------------------------------------------
-- `stalePinMembers` counts every active member with `must_change_pin = false`
-- and calls them all stale. But `false` is the *normal* state — `change_own_pin`
-- sets it once the person has chosen their own. So every account that had
-- already done the right thing was reported as a problem, the "Flag all"
-- button found nothing to flag (`flag_department_pins` only touches rows already
-- false→true, so it reports 0), and the banner stayed up forever.
--
-- The live roster on 24/11/2026: the supervisor was the only account with
-- `must_change_pin = false`, so the banner said "1 person can still sign in with
-- the PIN the department set" about the one person who had changed theirs. No
-- button on that screen could make that sentence go away.
--
-- `seed_pin_flag` records whether an account is still on a PIN somebody else
-- chose. It is set at creation, cleared by `change_own_pin`, and settable in
-- bulk by a supervisor. The banner reads it instead of guessing from the
-- must-change flag.
--
-- ----------------------------------------------------------------------------
-- 3. Setting a PIN did not tell the person to choose their own
-- ----------------------------------------------------------------------------
-- `upsert_team_member` only set `must_change_pin = true` when a PIN was supplied
-- — which is right — but nothing distinguished "the department chose this" from
-- "this person chose this". Now both flags move together, so the banner, the
-- forced-change wall and the roster badge all read one fact.

BEGIN;
-- ----------------------------------------------------------------------------
-- 1. Which accounts are still on a PIN somebody else chose
-- ----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS seed_pin_flag boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.seed_pin_flag IS
  'True while this account still signs in with a PIN the department chose. Set at creation and by a supervisor reset; cleared by change_own_pin.';

-- Existing accounts: the ones that have never changed their PIN are the ones
-- still on a department PIN. `must_change_pin = false` means either "never
-- flagged" or "already chose their own", and those two are only distinguishable
-- by whether the credential has been rewritten since seeding — which we cannot
-- know. So we start everyone at false and let a supervisor say otherwise with
-- one action, rather than presenting a banner that cannot be cleared.
UPDATE public.users SET seed_pin_flag = false WHERE seed_pin_flag IS DISTINCT FROM false;

-- ----------------------------------------------------------------------------
-- 2. Creating a member with a PIN the supervisor chose marks them
-- ----------------------------------------------------------------------------
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

    INSERT INTO public.users (group_id, username, full_name, phone, role, is_active, must_change_pin, seed_pin_flag)
    VALUES (p_group_id, v_clean_username, trim(p_full_name), v_clean_phone, p_role, p_is_active, true, true)
    RETURNING id INTO v_target_id;

    INSERT INTO public.user_credentials (user_id, pin_hash)
    VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')));
  ELSE
    -- Going off duty is only allowed with an empty hand: `dispatch_load` stops
    -- showing an inactive technician, so their jobs would leave every lane while
    -- staying assigned. (Added in 034.)
    IF p_is_active IS FALSE THEN
      SELECT count(*), count(*) FILTER (WHERE status IN ('in_progress', 'blocked'))
      INTO v_held, v_active
      FROM public.tasks
      WHERE assigned_user_id = p_member_id
        AND group_id = p_group_id
        AND status IN ('assigned', 'in_progress', 'blocked');

      IF v_active > 0 THEN
        RAISE EXCEPTION 'This job is being worked on right now. It cannot be taken off the board while somebody is at the customer.'
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_held > 0 THEN
        RAISE EXCEPTION '% job(s) are still assigned to this person. Move them to somebody else, then take them off duty.', v_held
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

      INSERT INTO public.user_credentials (user_id, pin_hash, failed_attempts, locked_until)
      VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')), 0, NULL)
      ON CONFLICT (user_id) DO UPDATE
      SET pin_hash = EXCLUDED.pin_hash,
          -- A new credential is a new start. The lock exists to slow down
          -- guessing; the supervisor issuing a PIN has already established who
          -- this is. Leaving the lock in place is what made "he cannot get in,
          -- give him a new PIN" fail silently.
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = now();

      -- The department chose this one, so it is still a shared secret until the
      -- person replaces it. Both flags move together so the banner, the forced
      -- change wall and the roster badge cannot disagree.
      UPDATE public.users
      SET must_change_pin = true, seed_pin_flag = true
      WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN v_target_id;
END;
$function$;

COMMENT ON FUNCTION public.upsert_team_member(uuid, uuid, uuid, text, text, text, text, text, boolean) IS
  'Create or edit a team member. Refuses to deactivate somebody holding open work; a supplied PIN clears any lock and marks the account as being on a department PIN.';

-- ----------------------------------------------------------------------------
-- 3. Choosing your own PIN ends the department-PIN state
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_own_pin(p_token uuid, p_current_pin text, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user public.users;
  v_hash text;
BEGIN
  v_user := public.get_session_user(p_token);

  IF p_new_pin IS NULL OR length(trim(p_new_pin)) < 4 OR length(trim(p_new_pin)) > 6 THEN
    RAISE EXCEPTION 'A PIN must be 4 to 6 digits';
  END IF;

  SELECT pin_hash INTO v_hash FROM public.user_credentials WHERE user_id = v_user.id;
  IF v_hash IS NULL OR v_hash <> extensions.crypt(trim(p_current_pin), v_hash) THEN
    RAISE EXCEPTION 'The current PIN is not correct';
  END IF;

  UPDATE public.user_credentials
     SET pin_hash = extensions.crypt(trim(p_new_pin), extensions.gen_salt('bf')),
         failed_attempts = 0,
         locked_until = NULL
   WHERE user_id = v_user.id;

  -- Both flags, one fact: this person now holds a PIN nobody else knows.
  UPDATE public.users
  SET must_change_pin = false, seed_pin_flag = false
  WHERE id = v_user.id;

  RETURN true;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. A supervisor can clear the department-PIN state deliberately
-- ----------------------------------------------------------------------------
-- The old `flag_department_pins` could only ever set flags to true, and only on
-- rows that were already false — so it reported 0 forever and its banner could
-- not be dismissed. This replaces it with a call that moves both flags in the
-- requested direction, which is the action a supervisor actually needs.
CREATE OR REPLACE FUNCTION public.set_department_pin_flag(p_token uuid, p_flagged boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
  v_count int := 0;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can change the department PIN state';
  END IF;

  UPDATE public.users u
     SET seed_pin_flag = p_flagged,
         -- Flagging means "this is a shared PIN, make them choose their own".
         -- Clearing means "these people are on their own PIN", which is only
         -- true if they are not being forced to change.
         must_change_pin = CASE WHEN p_flagged THEN true ELSE false END,
         updated_at = now()
   WHERE u.group_id = v_caller.group_id
     AND u.is_active
     AND u.role IN ('supervisor', 'technician')
     AND u.seed_pin_flag IS DISTINCT FROM p_flagged;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('changed', v_count, 'flagged', p_flagged);
END;
$function$;

COMMENT ON FUNCTION public.set_department_pin_flag(uuid, boolean) IS
  'Move every active member onto (or off) the "still using a department PIN" state. Replaces flag_department_pins, which could only set the flag and never clear it.';

-- Keep the old name working for any client still calling it, but make it do the
-- honest thing: flag everybody, and report how many actually changed.
CREATE OR REPLACE FUNCTION public.flag_department_pins(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.set_department_pin_flag(p_token, true);
  RETURN jsonb_build_object(
    'flagged', (v_result->>'changed')::int,
    'at', now()
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. One read for the roster: who is on a department PIN
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pin_status(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can read the PIN state';
  END IF;

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN jsonb_build_object(
    'on_department_pin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name) ORDER BY u.full_name)
      FROM public.users u
      WHERE u.group_id = p_group_id
        AND u.is_active
        AND u.role IN ('supervisor', 'technician')
        AND u.seed_pin_flag
    ), '[]'::jsonb),
    'locked', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'until', c.locked_until) ORDER BY c.locked_until)
      FROM public.users u
      JOIN public.user_credentials c ON c.user_id = u.id
      WHERE u.group_id = p_group_id
        AND u.is_active
        AND c.locked_until IS NOT NULL
        AND c.locked_until > now()
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.pin_status(uuid, uuid) IS
  'Who still signs in with a department PIN, and which accounts are currently locked out. Both are things a supervisor must see to act on.';

GRANT EXECUTE ON FUNCTION public.pin_status(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_department_pin_flag(uuid, boolean) TO anon, authenticated;

-- ============================================================================
-- PART TWO — the fault type
-- ============================================================================
--
-- A fault type that means something, and that both people who know it can set.
--
-- The complaint column is already read off the sheet and already stored: the OCR
-- template maps `complain-type` to `complain_type`, the importer puts it on the
-- payload, and `commit_import_batch` writes it. Nothing was missing from the
-- path. What was missing was *meaning*, and a way to correct it.
--
-- The live picture on 24/11/2026, for the 15 open faults:
--
--   CILAD ×2, DEG DEG ×2, Cilad DSL, deg deg, degdeg, wuu naga xun, das,
--   dadji, 636345542, c, dd, degdeg cabash, ok
--
-- Thirteen values, none of them a fault type. "CILAD"/"degdeg" mean "fault" and
-- "urgent" — the sheet's *category* and *urgency*, written where the fault type
-- belongs, because that is what the customer said on the phone. One is a phone
-- number. So every fault reads as "not recorded", and the board cannot route on
-- what is wrong.
--
-- There is a *fourth* fault, found only by reading the audit log, and it is the
-- reason the numbers above had already changed by the time this migration was
-- written. At 22:49 on 24/11 every one of the thirteen open faults was edited
-- within three seconds, each with `fault_type` going from NULL to `no_signal`
-- (`task_work_logs`, action `edited`, before.fault_type = null). The cause is
-- `BulkEditSheet`: its action defaults to "Fault type" and its select defaults
-- to `'no_signal'`, so opening the sheet and pressing the primary button
-- reformed every unclassified fault into "No signal" without anybody choosing
-- it. A fault type is a fact; a default that writes one is a guess presented as
-- a fact. The sheet now starts with no type chosen and refuses to apply an empty
-- choice.
--
-- Those thirteen values cannot be recovered — `no_signal` is indistinguishable
-- from a type somebody genuinely chose. What can be done is to stop the sheet
-- inventing them and to make the next correction possible.

-- Two facts make this fixable without guessing:
--
--   1. The taxonomy already exists in the client (`FAULT_TYPES` in
--      `src/lib/faults.ts`): no_signal, slow_speed, cut_cable, faulty_box,
--      damaged_port, loose_connector, power, other. It was never enforced.
--   2. A fault type is genuinely unknown at import time — the customer often
--      cannot say whether it is slow speed or a cut cable until somebody calls
--      them back. So the column must accept "unknown", and must accept a
--      correction later, from the supervisor *and* from the technician on site.
--
-- Part two therefore does three things:
--
--   * keeps the sheet's own words in `complaint_raw`, so nothing is lost when a
--     value cannot be mapped;
--   * constrains `fault_type` to the taxonomy, so a phone number can never be
--     stored there again;
--   * lets a technician set it on a job assigned to them — a supervisor-only
--     edit means the person who actually finds the cut cable cannot record it.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- 1. Keep what the sheet said, even when it is not a fault type
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS complaint_raw text;

COMMENT ON COLUMN public.tasks.complaint_raw IS
  'The complaint column exactly as the sheet carried it. Kept even when it is urgency or noise, because it is the customer''s own words and the only clue to the real fault.';

-- Freeze the sheet's own words here. Note the column it comes from: the
-- complaint text already lives in `complain_type` (written by
-- `commit_import_batch`), and `fault_type` is the *typed* column next to it.
--
-- These were briefly the same column, which is how a value of `no_signal` ended
-- up being read as "what the customer said" — see the note on the backfill
-- below before trusting any of it.
UPDATE public.tasks
SET complaint_raw = NULLIF(btrim(complain_type), '')
WHERE task_type = 'cilada'
  AND complain_type IS NOT NULL
  AND btrim(complain_type) <> ''
  AND COALESCE(complaint_raw, '') IS DISTINCT FROM btrim(complain_type);

-- ----------------------------------------------------------------------------
-- 2. Constrain the column to the taxonomy
-- ----------------------------------------------------------------------------
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_fault_type_taxonomy'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_fault_type_taxonomy
      CHECK (fault_type IS NULL OR fault_type IN (
        'no_signal', 'slow_speed', 'cut_cable', 'faulty_box',
        'damaged_port', 'loose_connector', 'power', 'other'
      ));
  END IF;
END $guard$;

-- ----------------------------------------------------------------------------
-- 3. One function decides what a complaint cell means
-- ----------------------------------------------------------------------------
-- The sheet says the same thing many ways, and half of what arrives is urgency
-- rather than cause. Mapping it in one place means the importer, the bulk tool
-- and the phone-call form all agree, and it can be tested once.
--
-- Deliberately conservative: a value we cannot place returns NULL rather than
-- `other`, because "other" is a real answer somebody chose, and filling it in
-- for them hides the fact that nobody has looked yet.
CREATE OR REPLACE FUNCTION public.fault_type_from_complaint(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  t text := lower(btrim(COALESCE(p_raw, '')));
BEGIN
  IF t = '' THEN RETURN NULL; END IF;

  -- A phone number, a single letter, a bare digit string: OCR spill, never a
  -- fault type. Ten of the thirteen live values failed this.
  IF t ~ '^[0-9[:space:]+()-]{6,}$' THEN RETURN NULL; END IF;
  IF length(regexp_replace(t, '[^a-z]', '', 'g')) < 3 THEN RETURN NULL; END IF;

  -- Urgency words. These describe *how bad*, not *what*: "degdeg" is "urgent"
  -- in Somali and was landing here eleven times. Reading them as a fault type
  -- would silently invent one.
  IF t ~ '^(deg ?deg|degdeg|dd|dadji|dadaji|urgent|soon|degdeg cabash|degdeg cabasho)$' THEN
    RETURN NULL;
  END IF;

  -- "cilad"/"cilada" is the sheet's *category* word for a fault job — the whole
  -- row is already a fault. It carries no cause.
  IF t ~ '^(cilad|cilada|cilad dsl|cilada dsl|fault|complaint)$' THEN
    RETURN NULL;
  END IF;

  -- Now the actual causes, in Somali and English, as the sheets and the phone
  -- calls write them.
  IF t ~ '(signal|calaamad|xiriir|lost|ma jirto|no light|iftiin ma)'
     OR t ~ '^ma (soo|hel|jirin)' THEN
    RETURN 'no_signal';
  END IF;

  IF t ~ '(slow|gaabis|gaab|xaaw|speed|xawaare|dhakhso|fast)'
     OR t ~ '(internet ?(yar|yaraaday)|hooseeya)' THEN
    RETURN 'slow_speed';
  END IF;

  IF t ~ '(cut|go.?ay|gooy|jab|break|qod|xadhig|xarig)' THEN
    RETURN 'cut_cable';
  END IF;

  IF t ~ '(box|sanduuq|splitter|cabinet|dul ?ka)' THEN
    RETURN 'faulty_box';
  END IF;

  IF t ~ '(port|deegaan|booska)' THEN
    RETURN 'damaged_port';
  END IF;

  IF t ~ '(loose|dabacsan|isku.?xir|connector|fiilo dabacsan)' THEN
    RETURN 'loose_connector';
  END IF;

  IF t ~ '(power|koronto|electric|nal|laydh)' THEN
    RETURN 'power';
  END IF;

  IF t ~ '^(ok|okay|fine|waa ?hagaag|hagaag)$' THEN
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fault_type_from_complaint(text) IS
  'Map a sheet complaint cell onto the fault-type taxonomy. Returns NULL for urgency words, category words, phone numbers and anything unrecognised — guessing would be worse than an honest blank.';

-- ----------------------------------------------------------------------------
-- 3a. The roster's job list, not just its job count
-- ----------------------------------------------------------------------------
-- `team_workload` returned seven columns: enough to say "3 jobs, 1 in progress",
-- which is what the retirement rule needed. It could not show the jobs, so a
-- supervisor looking at a person's card could see that they were holding work
-- but not what it was — and therefore could not open, correct or remove any of
-- it from this screen.
CREATE OR REPLACE FUNCTION public.team_workload(p_token uuid, p_group_id uuid)
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
    SELECT t.id, t.line_number, t.customer_name, t.status, t.task_type,
           t.assigned_user_id, t.assigned_crew_id,
           t.customer_phone, t.xaafada, t.cablebox_code_raw,
           t.fault_type, t.priority, t.reported_date, t.created_at
    FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('assigned', 'in_progress', 'blocked')
      AND (t.assigned_user_id IS NOT NULL OR t.assigned_crew_id IS NOT NULL)
  ) j;

  RETURN jsonb_build_object('jobs', v_jobs);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3b. A log action for "somebody said what the fault was"
-- ----------------------------------------------------------------------------
-- `task_work_logs.action` is a CHECK list, and it had no value for this. Reusing
-- `edited` would have buried the one event that changes what a job *is* inside
-- "changed the street name" — and the audit trail is the only way to answer
-- "who said this was a cut cable, and when".
ALTER TABLE public.task_work_logs DROP CONSTRAINT IF EXISTS task_work_logs_action_check;

ALTER TABLE public.task_work_logs ADD CONSTRAINT task_work_logs_action_check
  CHECK (action = ANY (ARRAY[
    'imported','assigned','unassigned','started','paused','blocked','resumed',
    'completed','reopened','cancelled','scheduled','en_route','edited',
    'fault_type_set'
  ]));

-- ----------------------------------------------------------------------------
-- 4. Writing a fault type, for the two people who actually know it
-- ----------------------------------------------------------------------------
-- A supervisor can set it on any fault in the group. A technician can set it on
-- a fault assigned to them, because they are the one standing at the box. Both
-- are logged with the previous value, so "who said it was a cut cable" survives.
CREATE OR REPLACE FUNCTION public.set_fault_type(
  p_token uuid,
  p_task_id uuid,
  p_fault_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_before text;
  v_new text := NULLIF(btrim(COALESCE(p_fault_type, '')), '');
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF v_task.id IS NULL OR v_task.group_id <> v_caller.group_id THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF v_caller.role = 'technician' AND v_task.assigned_user_id IS DISTINCT FROM v_caller.id THEN
    RAISE EXCEPTION 'A technician can only describe the fault on their own job';
  END IF;

  IF v_caller.role NOT IN ('supervisor', 'technician') THEN
    RAISE EXCEPTION 'Only a supervisor or the assigned technician can set the fault type';
  END IF;

  IF v_task.task_type <> 'cilada' THEN
    RAISE EXCEPTION 'Only a fault job has a fault type';
  END IF;

  IF v_new IS NOT NULL AND v_new NOT IN (
    'no_signal', 'slow_speed', 'cut_cable', 'faulty_box',
    'damaged_port', 'loose_connector', 'power', 'other'
  ) THEN
    RAISE EXCEPTION '"%" is not a fault type. Choose one from the list.', v_new;
  END IF;

  v_before := v_task.fault_type;

  UPDATE public.tasks
  SET fault_type = v_new,
      updated_at = now()
  WHERE id = v_task.id;

  INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
  VALUES (v_task.id, v_caller.id, 'fault_type_set',
          jsonb_build_object('from', v_before, 'to', v_new)::text);

  RETURN jsonb_build_object('task_id', v_task.id, 'before', v_before, 'fault_type', v_new);
END;
$function$;

COMMENT ON FUNCTION public.set_fault_type(uuid, uuid, text) IS
  'Set or clear the fault type on a fault job. Supervisor: any job in the group. Technician: their own job only. Logged with the previous value.';

GRANT EXECUTE ON FUNCTION public.set_fault_type(uuid, uuid, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Import: map the complaint cell into the taxonomy, keep the raw words
-- ----------------------------------------------------------------------------
-- The importer sends `complain_type` and `complaint_raw`; the mapping happens
-- here so a sheet uploaded from a laptop and one uploaded from a phone land in
-- the same place. The raw value is preserved for every row, mapped or not.
CREATE OR REPLACE FUNCTION public.apply_import_complaint(
  p_task_id uuid,
  p_complaint_raw text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text := NULLIF(btrim(COALESCE(p_complaint_raw, '')), '');
BEGIN
  IF v_raw IS NULL THEN RETURN; END IF;

  UPDATE public.tasks
  SET complaint_raw = COALESCE(complaint_raw, v_raw),
      -- Never overwrite a type somebody has already chosen by hand.
      fault_type = COALESCE(fault_type, public.fault_type_from_complaint(v_raw)),
      updated_at = now()
  WHERE id = p_task_id
    AND task_type = 'cilada';
END;
$function$;

COMMENT ON FUNCTION public.apply_import_complaint(uuid, text) IS
  'Store the sheet complaint verbatim and map it onto a fault type when possible, without overwriting a type already set by hand.';

GRANT EXECUTE ON FUNCTION public.apply_import_complaint(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fault_type_from_complaint(text) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- Rollback
-- ============================================================================
-- Deliberately not a copy of the replaced function bodies: restoring a copy
-- risks restoring a stale copy. Re-apply them from 033 and 034 instead.
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.pin_status(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.set_department_pin_flag(uuid, boolean);
--   ALTER TABLE public.users DROP COLUMN IF EXISTS seed_pin_flag;
--   DROP FUNCTION IF EXISTS public.apply_import_complaint(uuid, text);
--   DROP FUNCTION IF EXISTS public.set_fault_type(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.fault_type_from_complaint(text);
--   -- Remove the taxonomy constraint only if you also intend to allow free text
--   -- back into fault_type. complaint_raw is never dropped: it holds the only
--   -- copy of the original complaint values that were once misfiled as a type.
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_fault_type_taxonomy;
-- COMMIT;
