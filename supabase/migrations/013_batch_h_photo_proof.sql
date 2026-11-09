-- ============================================================================
-- 013 — Batch H, part 2: photo proof on completion
--
-- "Prove the technician was actually there." dBm and notes are evidence a
-- technician types; a photograph of the joint they made is evidence they had to
-- stand in front of.
--
-- Three rules, and they are the whole design:
--
--   * A photo belongs to a **completed** job. There is nothing to prove about
--     work that has not happened.
--   * Only the person who worked the job, or the supervisor of the group, can
--     attach one.
--   * Photos live in a private table, never a public bucket — the same lesson
--     Batch B learned about sheet photographs. Bytes are readable only through
--     get_task_photo(), which checks the caller's group first.
--
-- This migration also corrects two definitions in 012 that did not match what
-- the report screen claims. Both are described at the point they change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The private table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  byte_size int NOT NULL CHECK (byte_size > 0),
  image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_photos IS
  'Photographic proof of a completed job. Private: reachable only through add_task_photo / get_task_photo.';

ALTER TABLE public.task_photos ENABLE ROW LEVEL SECURITY;
-- No policies on purpose — the table is reachable only through the functions below.

CREATE INDEX IF NOT EXISTS idx_task_photos_task ON public.task_photos(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_photos_group ON public.task_photos(group_id, created_at DESC);

-- The newest proof, denormalised onto the job so a board or a feed does not have
-- to ask a second question to know a photo exists. `list_open_tasks` and
-- `get_task` return `public.tasks`, so this column reaches the client for free.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS proof_photo_id uuid REFERENCES public.task_photos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.proof_photo_id IS
  'The most recent completion photo for this job; null until one is attached.';

-- ----------------------------------------------------------------------------
-- 2. Attach a photo
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_task_photo(
  p_token uuid,
  p_task_id uuid,
  p_mime text,
  p_base64 text
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
  v_id uuid;
BEGIN
  v_user := public.get_session_user(p_token);
  v_task := public.get_task(p_token, p_task_id);

  IF public.is_task_worker(v_user, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only the technician on this job, or the supervisor, can attach a photo';
  END IF;

  -- A photo of an unfinished job proves nothing, and would let the camera become
  -- a way of marking work done by implication.
  IF v_task.status <> 'completed' THEN
    RAISE EXCEPTION 'A proof photo belongs to a completed job';
  END IF;

  IF p_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only JPEG and PNG photos can be stored';
  END IF;

  IF p_base64 IS NULL OR length(p_base64) < 100 THEN
    RAISE EXCEPTION 'The photo is empty';
  END IF;

  v_bytes := decode(p_base64, 'base64');

  -- The client compresses to ~640 px / quality 0.6 (usually 40–120 kB); this is a
  -- backstop against a caller that does not, because the database is 500 MB on
  -- the Free plan and photographs are the only thing in it that grows fast.
  IF octet_length(v_bytes) > 2 * 1024 * 1024 THEN
    RAISE EXCEPTION 'The photo is larger than 2 MB';
  END IF;

  SELECT count(*) INTO v_existing FROM public.task_photos WHERE task_id = v_task.id;
  IF v_existing >= 3 THEN
    RAISE EXCEPTION 'This job already has three photos';
  END IF;

  INSERT INTO public.task_photos (group_id, task_id, uploaded_by, mime, byte_size, image)
  VALUES (v_task.group_id, v_task.id, v_user.id, p_mime, octet_length(v_bytes), v_bytes)
  RETURNING id INTO v_id;

  UPDATE public.tasks SET proof_photo_id = v_id WHERE id = v_task.id;

  RETURN jsonb_build_object(
    'id', v_id,
    'byte_size', octet_length(v_bytes),
    'created_at', now()
  );
END;
$fn$;

COMMENT ON FUNCTION public.add_task_photo(uuid, uuid, text, text) IS
  'Attach proof to a completed job. Worker or supervisor only, max 3 per job, 2 MB each.';

-- ----------------------------------------------------------------------------
-- 3. Read the metadata, and read one photo
-- ----------------------------------------------------------------------------

/** Which photos a job has — thumbnails are fetched separately, one at a time. */
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

/** One photo, as base64. Same shape as get_sheet_image. */
CREATE OR REPLACE FUNCTION public.get_task_photo(p_token uuid, p_photo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user public.users;
  v_row public.task_photos;
BEGIN
  v_user := public.get_session_user(p_token);

  SELECT * INTO v_row
  FROM public.task_photos p
  WHERE p.id = p_photo_id AND p.group_id = v_user.group_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Photo not found in this group';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'task_id', v_row.task_id,
    'mime', v_row.mime,
    'byte_size', v_row.byte_size,
    'created_at', v_row.created_at,
    'base64', encode(v_row.image, 'base64')
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. The feed learns that a completion has proof
-- ----------------------------------------------------------------------------
-- Same function as 012, one added field: `photo_id`. A supervisor scrolling the
-- record can open the photograph of the job from the row itself, without
-- knowing the job's id or leaving the feed.

CREATE OR REPLACE FUNCTION public.group_activity(
  p_token uuid,
  p_group_id uuid,
  p_days int DEFAULT 7,
  p_limit int DEFAULT 200
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

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_since := now() - (greatest(1, least(p_days, 400)) || ' days')::interval;

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
        t.proof_photo_id AS photo_id
      FROM public.task_work_logs w
      JOIN public.tasks t ON t.id = w.task_id
      LEFT JOIN public.users u ON u.id = w.user_id
      WHERE t.group_id = p_group_id
        AND w.created_at >= v_since

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
        NULL
      FROM public.dispatch_log d
      LEFT JOIN public.users u ON u.id = d.sent_by
      WHERE d.group_id = p_group_id
        AND d.created_at >= v_since

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
        NULL
      FROM public.tasks t
      LEFT JOIN public.users u ON u.id = t.cancelled_by
      WHERE t.group_id = p_group_id
        AND t.cancelled_at IS NOT NULL
        AND t.cancelled_at >= v_since

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
        NULL
      FROM public.tasks t
      LEFT JOIN public.users u ON u.id = t.created_by
      WHERE t.group_id = p_group_id
        AND t.source = 'manual'
        AND t.created_at >= v_since

      ORDER BY at DESC
      LIMIT greatest(1, least(p_limit, 500))
    ) x
  ), '[]'::jsonb);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. The period report, corrected
-- ----------------------------------------------------------------------------
-- Two definitions in 012 were wrong for a *past* period, and the screen says
-- otherwise:
--
--   open_at_end      used today's status, so a job finished this morning
--                    disappeared from last month's report. It now asks whether
--                    the job was still open at the end of the range.
--   waiting_over_sla counted from created_at, while the board's aging badge
--                    counts from reported_date — the date the customer uses.
--                    They now measure the same thing.
--
-- The report also gains `photos`: how many completion photographs were attached
-- in the period. Evidence is a number a manager can be shown.

CREATE OR REPLACE FUNCTION public.period_report(
  p_token uuid,
  p_group_id uuid,
  p_from date,
  p_to date
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

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user.id AND u.group_id = p_group_id) THEN
    RAISE EXCEPTION 'Not allowed for this group';
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

    'totals', jsonb_build_object(
      'created', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
      ),
      'completed', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
      ),
      'cancelled', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.cancelled_at >= v_from_ts AND t.cancelled_at < v_to_ts
      ),
      -- Open *as at the end of the period*: existed by then, and not yet closed.
      'open_at_end', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.created_at < v_to_ts
          AND (t.completed_at IS NULL OR t.completed_at >= v_to_ts)
          AND (t.cancelled_at IS NULL OR t.cancelled_at >= v_to_ts)
      ),
      -- The number that matters most: open at the end, and past the promise,
      -- counted from the day the customer reported it.
      'waiting_over_sla', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id
          AND t.created_at < v_to_ts
          AND (t.completed_at IS NULL OR t.completed_at >= v_to_ts)
          AND (t.cancelled_at IS NULL OR t.cancelled_at >= v_to_ts)
          AND coalesce(t.reported_date::timestamptz, t.created_at) < v_to_ts - interval '3 days'
      ),
      'avg_minutes', (
        SELECT coalesce(round(avg(t.accumulated_seconds) / 60.0), 0)
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
          AND t.accumulated_seconds > 0
      ),
      'avg_dbm', (
        SELECT round(avg(t.optical_dbm)::numeric, 1)
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'completed'
          AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
          AND t.optical_dbm IS NOT NULL
      ),
      'repeat_faults', (
        SELECT count(*) FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.is_repeat_fault
          AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
      ),
      'dispatches', (
        SELECT count(*) FROM public.dispatch_log d
        WHERE d.group_id = p_group_id
          AND d.created_at >= v_from_ts AND d.created_at < v_to_ts
      ),
      -- Completions that carry a photograph.
      'photos', (
        SELECT count(*) FROM public.task_photos p
        WHERE p.group_id = p_group_id
          AND p.created_at >= v_from_ts AND p.created_at < v_to_ts
      )
    ),

    'techs', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.completed DESC, x.name)
      FROM (
        SELECT
          u.id,
          u.full_name AS name,
          count(t.id) AS completed,
          coalesce(round(avg(t.accumulated_seconds) / 60.0), 0) AS avg_minutes,
          round(avg(t.optical_dbm)::numeric, 1) AS avg_dbm
        FROM public.users u
        LEFT JOIN public.tasks t
          ON t.completed_by = u.id
         AND t.status = 'completed'
         AND t.completed_at >= v_from_ts AND t.completed_at < v_to_ts
        WHERE u.group_id = p_group_id AND u.role IN ('technician', 'supervisor')
        GROUP BY u.id, u.full_name
      ) x
    ), '[]'::jsonb),

    'boxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.faults DESC, x.box_code)
      FROM (
        SELECT
          b.box_code,
          b.health_status,
          b.total_ports,
          coalesce(cardinality(b.damaged_ports), 0) AS damaged_ports,
          (
            SELECT count(*) FROM public.tasks t
            WHERE t.cablebox_id = b.id
              AND t.created_at >= v_from_ts AND t.created_at < v_to_ts
          ) AS faults
        FROM public.cableboxes b
        WHERE b.group_id = p_group_id
      ) x
    ), '[]'::jsonb),

    'cancel_reasons', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.count DESC)
      FROM (
        SELECT coalesce(t.cancel_reason, 'unspecified') AS reason, count(*) AS count
        FROM public.tasks t
        WHERE t.group_id = p_group_id
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
            WHERE t.group_id = p_group_id AND t.status = 'completed'
              AND t.completed_at >= d AND t.completed_at < d + interval '1 day') AS completed,
          (SELECT count(*) FROM public.tasks t
            WHERE t.group_id = p_group_id
              AND t.created_at >= d AND t.created_at < d + interval '1 day') AS created
        FROM generate_series(v_from_ts, v_to_ts - interval '1 day', interval '1 day') AS d
      ) x
    ), '[]'::jsonb)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.add_task_photo(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_task_photos(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_photo(uuid, uuid) TO anon, authenticated;
