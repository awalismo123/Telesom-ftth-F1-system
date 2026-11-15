-- ============================================================================
-- 032 — Before-and-after photos
-- ============================================================================
--
-- A proof photo answers "is it fixed?". It cannot answer "was the fault where
-- the technician said it was", which is the question a repeat fault or a
-- disputed charge turns on. A photo taken on arrival answers that.
--
-- ## Numbering
--
-- The implementation plan called this file `026_photo_kind.sql`. 026 is already
-- the materials migration, so this is 032. The plan's number was written before
-- the phase order settled; the content is as planned.
--
-- ## Nothing is rewritten
--
-- `kind` is added with `DEFAULT 'after'` and `NOT NULL`. Every photo that exists
-- today therefore reads as `after`, which is exactly what it is: the only kind
-- that could be uploaded before this migration. No UPDATE, no backfill, no
-- chance of mislabelling an existing photo.
--
-- ## The guard that had to change
--
-- 013 refuses any photo unless the job is **completed** — "A proof photo belongs
-- to a completed job", and it is right about proof. But a *before* photo is
-- taken before the work, so the same guard would make the feature impossible.
--
-- The rule is now split by kind:
--   * `after`  — job must be completed. Unchanged.
--   * `before` — job must exist and not be cancelled. Deliberately loose: a
--                technician may be at the door before pressing Start, and
--                refusing the photo then would teach them to skip it.
--
-- A before photo never overwrites `tasks.proof_photo_id`. The proof is an after
-- photo or it is nothing.
--
-- ## Signature compatibility
--
-- The 5-argument function deliberately has **no default** and the old
-- 4-argument function is kept as a thin wrapper. Two callable functions whose
-- parameter lists could both match a 4-argument call is exactly the situation
-- where PostgreSQL has to guess; a wrapper removes the guess. An old client
-- calling `add_task_photo(token, task, mime, b64)` still lands as `after`, with
-- the old rules intact.
--
-- ## Storage
--
-- Photos are `bytea` inside a 500 MB free database. The cap was 3 per job; it is
-- now 3 **per kind**, so 6. That doubles the worst case per job and is recorded
-- in KNOWN_LIMITS. If volume grows, the honest fix is object storage, not
-- smaller proof.

-- ----------------------------------------------------------------------------
-- 1. The column
-- ----------------------------------------------------------------------------

ALTER TABLE public.task_photos
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'after';

-- Its own statement: a CHECK is not added inside the ALTER above because the
-- constraint has to be droppable independently when the vocabulary changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_photos_kind_check'
      AND conrelid = 'public.task_photos'::regclass
  ) THEN
    ALTER TABLE public.task_photos
      ADD CONSTRAINT task_photos_kind_check CHECK (kind IN ('before', 'after'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.task_photos.kind IS
  'before = on arrival, after = proof of completion. Existing rows are after.';

-- ----------------------------------------------------------------------------
-- 2. add_task_photo, with a kind
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_task_photo(
  p_token uuid,
  p_task_id uuid,
  p_mime text,
  p_base64 text,
  p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
  v_task public.tasks;
  v_bytes bytea;
  v_existing int;
  v_kind text := COALESCE(NULLIF(btrim(p_kind), ''), 'after');
  v_id uuid;
BEGIN
  v_user := public.get_session_user(p_token);
  v_task := public.get_task(p_token, p_task_id);

  IF public.is_task_worker(v_user, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only the technician on this job, or the supervisor, can attach a photo';
  END IF;

  IF v_kind NOT IN ('before', 'after') THEN
    RAISE EXCEPTION 'Photo kind must be before or after';
  END IF;

  -- Proof still belongs to a completed job. A before photo does not: it is
  -- taken when the job has not been done yet.
  IF v_kind = 'after' AND v_task.status <> 'completed' THEN
    RAISE EXCEPTION 'A proof photo belongs to a completed job';
  END IF;

  IF v_kind = 'before' AND v_task.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled job cannot take a photo';
  END IF;

  IF p_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only JPEG and PNG photos can be stored';
  END IF;

  IF p_base64 IS NULL OR length(p_base64) < 100 THEN
    RAISE EXCEPTION 'The photo is empty';
  END IF;

  v_bytes := decode(p_base64, 'base64');

  IF octet_length(v_bytes) > 2 * 1024 * 1024 THEN
    RAISE EXCEPTION 'The photo is larger than 2 MB';
  END IF;

  -- Three of each kind: three on arrival, three of the finished work.
  SELECT count(*) INTO v_existing
  FROM public.task_photos
  WHERE task_id = v_task.id AND kind = v_kind;

  IF v_existing >= 3 THEN
    RAISE EXCEPTION 'This job already has three % photos', v_kind;
  END IF;

  INSERT INTO public.task_photos (group_id, task_id, uploaded_by, mime, byte_size, image, kind)
  VALUES (v_task.group_id, v_task.id, v_user.id, p_mime, octet_length(v_bytes), v_bytes, v_kind)
  RETURNING id INTO v_id;

  -- Only proof moves the pointer. A before photo is evidence, not a result.
  IF v_kind = 'after' THEN
    UPDATE public.tasks SET proof_photo_id = v_id WHERE id = v_task.id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'kind', v_kind,
    'byte_size', octet_length(v_bytes),
    'created_at', now()
  );
END;
$fn$;

COMMENT ON FUNCTION public.add_task_photo(uuid, uuid, text, text, text) IS
  'Attach a before or after photo. Worker or supervisor only, max 3 per kind, 2 MB each.';

-- ----------------------------------------------------------------------------
-- 3. The old four-argument call, kept working exactly as it did
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_task_photo(
  p_token uuid,
  p_task_id uuid,
  p_mime text,
  p_base64 text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT public.add_task_photo(p_token, p_task_id, p_mime, p_base64, 'after');
$fn$;

COMMENT ON FUNCTION public.add_task_photo(uuid, uuid, text, text) IS
  'Deprecated alias: attaches an after photo. Use the five-argument form with a kind.';

-- ----------------------------------------------------------------------------
-- 4. The list has to say which is which
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_task_photos(p_token uuid, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_task public.tasks;
BEGIN
  -- get_task proves the caller belongs to the job's group.
  v_task := public.get_task(p_token, p_task_id);

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT
        p.id,
        p.mime,
        p.byte_size,
        p.created_at,
        p.kind,
        coalesce(u.full_name, '—') AS uploaded_by_name,
        coalesce(u.role, 'system') AS uploaded_by_role
      FROM public.task_photos p
      LEFT JOIN public.users u ON u.id = p.uploaded_by
      WHERE p.task_id = v_task.id
      LIMIT 10
    ) x
  ), '[]'::jsonb);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. Grants
-- ----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.add_task_photo(uuid, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_task_photo(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_task_photos(uuid, uuid) TO anon, authenticated;

-- ============================================================================
-- Rollback
-- ============================================================================
--   -- Reverts the upload rules but leaves the column, which is harmless:
--   DROP FUNCTION IF EXISTS public.add_task_photo(uuid, uuid, text, text, text);
--   -- then re-apply the 013 definition of add_task_photo(uuid,uuid,text,text)
--   -- and list_task_photos(uuid,uuid).
--
-- The `kind` column is deliberately NOT dropped: it is NOT NULL with a default,
-- every existing row is 'after', and dropping it would destroy the distinction
-- on any before photo taken in the meantime. It costs a few bytes per row.
--
-- No task, timer or completion record is touched by this migration.
-- ============================================================================
