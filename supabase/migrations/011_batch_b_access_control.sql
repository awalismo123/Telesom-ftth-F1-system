-- ============================================================================
-- 011 — Batch B: access control
--
-- Before this migration every operational table was readable by the anonymous
-- role (`FOR SELECT USING (true)`), so anyone holding the published anon key —
-- which is inside the JavaScript bundle — could read every customer name,
-- phone number and address without signing in. Write paths were already safe:
-- they all go through SECURITY DEFINER functions that validate a session token.
--
-- This migration closes the read side the same way:
--
--   1. every read the app needs becomes a token-checked function, scoped to the
--      caller's group;
--   2. the open SELECT policies are dropped, so the anon role can read nothing;
--   3. realtime moves from `postgres_changes` (which obeys RLS, and would now
--      deliver nothing) to a broadcast *signal* that carries no row data — the
--      client hears "something changed" and refetches through a checked RPC;
--   4. sheet photos leave the public bucket and go into a private table;
--   5. PINs get an attempt limit and a forced-change flag.
--
-- The anon key stays in the bundle on purpose: it is a public identifier, and
-- from here on it grants exactly what the functions below allow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PIN attempt limiting
-- ----------------------------------------------------------------------------

ALTER TABLE public.user_credentials
  ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

COMMENT ON COLUMN public.user_credentials.failed_attempts IS
  'Consecutive wrong PINs since the last success. Reset on success.';
COMMENT ON COLUMN public.user_credentials.locked_until IS
  'Sign-in refused until this moment. Set after too many wrong PINs.';

-- A person who has never chosen their own PIN should hear it from the app.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_pin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.must_change_pin IS
  'True until the user sets their own PIN. The client shows the change-PIN sheet before the app.';

-- ----------------------------------------------------------------------------
-- 2. authenticate_pin — with a lockout
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.authenticate_pin(p_identifier text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Five wrong PINs locks the account for fifteen minutes. 4 digits is 10,000
  -- combinations, so an unlimited endpoint is not a lock, it is a formality.
  c_max_attempts CONSTANT int := 5;
  c_lock_minutes CONSTANT int := 15;

  v_clean_id text := lower(trim(COALESCE(p_identifier, '')));
  v_trimmed_pin text := trim(COALESCE(p_pin, ''));
  v_digits text := regexp_replace(COALESCE(p_identifier, ''), '\D', '', 'g');
  v_user public.users;
  v_cred public.user_credentials;
  v_token uuid;
BEGIN
  -- Short or long PINs are refused without touching a hash.
  IF length(v_trimmed_pin) < 4 OR length(v_trimmed_pin) > 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT u.* INTO v_user
  FROM public.users u
  WHERE u.is_active = true
    AND (
      lower(u.username) = v_clean_id
      OR (v_digits <> '' AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') = v_digits)
      OR (length(v_digits) >= 7 AND right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 7) = right(v_digits, 7))
    )
  LIMIT 1;

  -- Unknown identifier: same answer as a wrong PIN, no hint that it exists.
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT * INTO v_cred FROM public.user_credentials WHERE user_id = v_user.id;

  IF v_cred.user_id IS NULL OR v_cred.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'retry_after_minutes', greatest(1, ceil(extract(epoch FROM (v_cred.locked_until - now())) / 60)::int)
    );
  END IF;

  IF v_cred.pin_hash <> extensions.crypt(v_trimmed_pin, v_cred.pin_hash) THEN
    UPDATE public.user_credentials
       SET failed_attempts = CASE
             WHEN failed_attempts + 1 >= c_max_attempts THEN 0
             ELSE failed_attempts + 1
           END,
           locked_until = CASE
             WHEN failed_attempts + 1 >= c_max_attempts THEN now() + (c_lock_minutes || ' minutes')::interval
             ELSE NULL
           END
     WHERE user_id = v_user.id;

    -- The fifth wrong PIN announces the lock immediately, so the person stops
    -- trying rather than waiting for a sixth answer that says the same thing.
    IF v_cred.failed_attempts + 1 >= c_max_attempts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after_minutes', c_lock_minutes);
    END IF;

    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Success clears the counter, even if the last lockout has just expired.
  UPDATE public.user_credentials
     SET failed_attempts = 0,
         locked_until = NULL
   WHERE user_id = v_user.id;

  INSERT INTO public.user_sessions (user_id)
  VALUES (v_user.id)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object('ok', true) || public.build_auth_payload(v_user.id, v_token);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. build_auth_payload — carry the forced-change flag to the client
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_auth_payload(p_user_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'token', p_token,
    'user', jsonb_build_object(
      'id', u.id,
      'group_id', u.group_id,
      'username', u.username,
      'full_name', u.full_name,
      'phone', u.phone,
      'role', u.role,
      'is_active', u.is_active,
      'preferred_lang', u.preferred_lang,
      'must_change_pin', u.must_change_pin
    ),
    'group', jsonb_build_object(
      'id', g.id,
      'code', g.code,
      'name', g.name
    ),
    'crews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'vehicle_tag', c.vehicle_tag,
        'zone_focus', c.zone_focus
      ))
      FROM public.crew_members cm
      JOIN public.crews c ON c.id = cm.crew_id
      WHERE cm.user_id = u.id AND c.is_active = true
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.users u
  JOIN public.groups g ON g.id = u.group_id
  WHERE u.id = p_user_id;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. change_own_pin — clears the forced-change flag
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.change_own_pin(p_token uuid, p_current_pin text, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

  UPDATE public.users SET must_change_pin = false WHERE id = v_user.id;

  RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Read functions — every one of them checks the token and the group
-- ----------------------------------------------------------------------------

/**
 * The caller's own group. Before this, `groups` was world-readable and the
 * client listed every group code in the department.
 */
CREATE OR REPLACE FUNCTION public.list_groups(p_token uuid)
RETURNS SETOF public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  RETURN QUERY
    SELECT g.* FROM public.groups g
    WHERE g.id = v_user.group_id
    ORDER BY g.code;
END;
$$;

/**
 * Everything the supervisor's shell and the team screen need, in one call:
 * the people, the crews, the crew links, the cableboxes, and the three counts
 * the header shows. One round trip instead of six, and each piece is scoped to
 * the caller's group — not "whatever the browser asked for".
 */
CREATE OR REPLACE FUNCTION public.group_overview(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_member boolean;
BEGIN
  v_user := public.get_session_user(p_token);

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.group_id = p_group_id AND u.id = v_user.id
  ) INTO v_member;

  IF NOT v_member THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'group_id', u.group_id,
        'username', u.username,
        'full_name', u.full_name,
        'phone', u.phone,
        'role', u.role,
        'is_active', u.is_active,
        'preferred_lang', u.preferred_lang,
        'must_change_pin', u.must_change_pin
      ) ORDER BY u.role, u.full_name)
      FROM public.users u WHERE u.group_id = p_group_id
    ), '[]'::jsonb),
    'crews', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name)
      FROM public.crews c WHERE c.group_id = p_group_id
    ), '[]'::jsonb),
    'crew_members', COALESCE((
      SELECT jsonb_agg(to_jsonb(cm))
      FROM public.crew_members cm
      JOIN public.crews c ON c.id = cm.crew_id
      WHERE c.group_id = p_group_id
    ), '[]'::jsonb),
    'cableboxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.box_code)
      FROM public.cableboxes b WHERE b.group_id = p_group_id
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'technicians', (SELECT count(*) FROM public.users u
                       WHERE u.group_id = p_group_id AND u.role = 'technician' AND u.is_active),
      'crews', (SELECT count(*) FROM public.crews c
                 WHERE c.group_id = p_group_id AND c.is_active),
      'open_tasks', (SELECT count(*) FROM public.tasks t
                      WHERE t.group_id = p_group_id
                        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')),
      'unassigned', (SELECT count(*) FROM public.tasks t
                      WHERE t.group_id = p_group_id AND t.status = 'unassigned')
    )
  );
END;
$$;

/** Open work for the dispatch board. Was `select * from tasks where group_id = …`. */
CREATE OR REPLACE FUNCTION public.list_open_tasks(p_token uuid, p_group_id uuid)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN QUERY
    SELECT t.* FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
    ORDER BY t.reported_date ASC NULLS LAST, t.created_at ASC
    LIMIT 600;
END;
$$;

/** One job, for the sheets that act on a specific task. */
CREATE OR REPLACE FUNCTION public.get_task(p_token uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_task public.tasks;
BEGIN
  v_user := public.get_session_user(p_token);

  SELECT t.* INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.group_id = v_user.group_id;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  RETURN v_task;
END;
$$;

/** The visit log for one job, oldest first — the audit trail on the sheet. */
CREATE OR REPLACE FUNCTION public.list_work_logs(p_token uuid, p_task_id uuid)
RETURNS SETOF public.task_work_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_task public.tasks;
BEGIN
  v_task := public.get_task(p_token, p_task_id);

  RETURN QUERY
    SELECT w.* FROM public.task_work_logs w
    WHERE w.task_id = v_task.id
    ORDER BY w.created_at ASC
    LIMIT 50;
END;
$$;

/** Jobs currently blocked or in progress — what the notification bell counts. */
CREATE OR REPLACE FUNCTION public.list_live_moves(p_token uuid, p_group_id uuid)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN QUERY
    SELECT t.* FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.status IN ('blocked', 'in_progress')
    ORDER BY t.updated_at DESC NULLS LAST
    LIMIT 100;
END;
$$;

/**
 * Jobs that were resumed since a moment — the "a blocked job is moving again"
 * half of the bell. Derived from the work log, never stored.
 */
CREATE OR REPLACE FUNCTION public.list_resumed_since(p_token uuid, p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT w.task_id, w.created_at, w.notes
      FROM public.task_work_logs w
      JOIN public.tasks t ON t.id = w.task_id
      WHERE t.group_id = v_user.group_id
        AND w.action = 'resumed'
        AND w.created_at >= p_since
      ORDER BY w.created_at DESC
      LIMIT 20
    ) x
  ), '[]'::jsonb);
END;
$$;

/** The last few imports, for the history strip on the ingest screen. */
CREATE OR REPLACE FUNCTION public.list_import_batches(p_token uuid, p_group_id uuid, p_limit int DEFAULT 8)
RETURNS SETOF public.import_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN QUERY
    SELECT b.* FROM public.import_batches b
    WHERE b.group_id = p_group_id
    ORDER BY b.created_at DESC
    LIMIT greatest(1, least(p_limit, 50));
END;
$$;

/** A technician's own crew mates — used to show "who you are working with". */
CREATE OR REPLACE FUNCTION public.my_team(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);

  RETURN jsonb_build_object(
    'crew_members', COALESCE((
      SELECT jsonb_agg(to_jsonb(cm))
      FROM public.crew_members cm
      JOIN public.crews c ON c.id = cm.crew_id
      WHERE c.group_id = v_user.group_id
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'group_id', u.group_id,
        'username', u.username,
        'full_name', u.full_name,
        'phone', u.phone,
        'role', u.role,
        'is_active', u.is_active,
        'preferred_lang', u.preferred_lang,
        'must_change_pin', u.must_change_pin
      ))
      FROM public.users u WHERE u.group_id = v_user.group_id
    ), '[]'::jsonb)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Sheet photos: out of the public bucket, into a private table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sheet_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  byte_size int NOT NULL,
  image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sheet_images IS
  'The photograph a batch was read from. Private: readable only through get_sheet_image.';

ALTER TABLE public.sheet_images ENABLE ROW LEVEL SECURITY;
-- No policies on purpose — the table is reachable only through the functions below.

CREATE INDEX IF NOT EXISTS idx_sheet_images_group ON public.sheet_images(group_id, created_at DESC);

/**
 * Store the source picture. Bytes travel as base64 because that is what an RPC
 * accepts; the ceiling is 4 MB, which is four times a typical phone photo of a
 * printed sheet after the client downsizes it.
 */
CREATE OR REPLACE FUNCTION public.upload_sheet_image(
  p_token uuid,
  p_group_id uuid,
  p_mime text,
  p_base64 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_bytes bytea;
  v_id uuid;
BEGIN
  v_user := public.get_session_user(p_token);

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  IF p_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only JPEG and PNG sheets can be stored';
  END IF;

  IF p_base64 IS NULL OR length(p_base64) < 100 THEN
    RAISE EXCEPTION 'The image is empty';
  END IF;

  v_bytes := decode(p_base64, 'base64');

  IF octet_length(v_bytes) > 4 * 1024 * 1024 THEN
    RAISE EXCEPTION 'The image is larger than 4 MB';
  END IF;

  INSERT INTO public.sheet_images (group_id, uploaded_by, mime, byte_size, image)
  VALUES (p_group_id, v_user.id, p_mime, octet_length(v_bytes), v_bytes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

/** Read one back — for the "where did these rows come from" audit view. */
CREATE OR REPLACE FUNCTION public.get_sheet_image(p_token uuid, p_image_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_row public.sheet_images;
BEGIN
  v_user := public.get_session_user(p_token);

  SELECT * INTO v_row
  FROM public.sheet_images s
  WHERE s.id = p_image_id AND s.group_id = v_user.group_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Image not found in this group';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'mime', v_row.mime,
    'byte_size', v_row.byte_size,
    'created_at', v_row.created_at,
    'base64', encode(v_row.image, 'base64')
  );
END;
$$;

-- The public bucket is emptied of its policies and made private. Existing rows
-- stay for the audit trail, but nothing can read them without a server-side key.
UPDATE storage.buckets SET public = false WHERE id = 'sheet-images';
DROP POLICY IF EXISTS "sheet images read" ON storage.objects;
DROP POLICY IF EXISTS "sheet images upload" ON storage.objects;

-- ----------------------------------------------------------------------------
-- 7. Realtime: a signal, never the data
-- ----------------------------------------------------------------------------

/**
 * Broadcast "something changed in this table" and nothing else.
 *
 * `postgres_changes` obeys row-level security, and after §6 the anon role can
 * read no rows at all — so the old feed would silently go dead. A broadcast
 * payload carries only a table name; the client hears it and refetches through
 * a token-checked function, so the customer data never travels on the feed.
 *
 * A failure here must never block the write that triggered it: a technician
 * completing a job is not allowed to fail because a notification failed.
 */
CREATE OR REPLACE FUNCTION public.broadcast_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME),
      'change',
      'f1:changes',
      false
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'realtime signal failed for %: %', TG_TABLE_NAME, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'tasks', 'task_work_logs', 'cableboxes', 'cablebox_ports', 'cablebox_logs',
    'crews', 'crew_members', 'users', 'import_batches', 'dispatch_log'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'broadcast_' || v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_change()',
      'broadcast_' || v_table, v_table
    );
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Close the read side
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow read groups" ON public.groups;
DROP POLICY IF EXISTS "Allow read users" ON public.users;
DROP POLICY IF EXISTS "Allow read crews" ON public.crews;
DROP POLICY IF EXISTS "Allow read crew_members" ON public.crew_members;
DROP POLICY IF EXISTS "Allow read cableboxes" ON public.cableboxes;
DROP POLICY IF EXISTS "Allow read cablebox_logs" ON public.cablebox_logs;
DROP POLICY IF EXISTS "Allow read import_batches" ON public.import_batches;
DROP POLICY IF EXISTS "Allow read tasks" ON public.tasks;
DROP POLICY IF EXISTS "Allow read task_work_logs" ON public.task_work_logs;
DROP POLICY IF EXISTS "Allow read dispatch_log" ON public.dispatch_log;
DROP POLICY IF EXISTS "Allow read cablebox_ports" ON public.cablebox_ports;

-- ----------------------------------------------------------------------------
-- 9. Grants — the new functions are callable by the anonymous role, because the
--    token inside them is the authorisation, not the role.
-- ----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.list_groups(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_overview(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_tasks(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_task(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_work_logs(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_live_moves(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_resumed_since(uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_import_batches(uuid, uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_team(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upload_sheet_image(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sheet_image(uuid, uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. A supervisor-issued PIN is a temporary PIN
--
-- If the supervisor creates the account or resets its PIN, the person must
-- choose their own before the app opens. A PIN two people know is not a
-- credential, and it makes the work log a record of "somebody".
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
