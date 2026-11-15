-- ============================================================================
-- 023 — a crew is one or two people
-- ============================================================================
--
-- The model says "2-tech crew / vehicle". The copy calls the second member a
-- partner. Nothing enforced either bound.
--
-- Measured on the live project (15/11/2026): both active crews had **zero**
-- members. Earlier the same day Crew B had three. Neither number is possible
-- under the model, and both are possible in the schema, because `crew_members`
-- is a plain join table with no cap and no floor.
--
-- Why this is not only cosmetic
-- -----------------------------
-- `today_summary` reports "crews out of N" by counting rows in `crews` with
-- `is_active`. An active crew with no members still counts toward N, so the
-- first screen a supervisor sees can read "0/2" while nobody is available at
-- all — and, in the reverse case, "2/2" while a three-person crew has taken the
-- only vehicle.
--
-- Three changes, all additive
-- ---------------------------
--   1. A hard cap of 2 members, enforced by a trigger so it holds whatever
--      writes to the table (the RPC, a future RPC, or a hand-run statement).
--   2. `upsert_crew` refuses to save an *active* crew with 0 members. An
--      inactive crew may have none — that is how a crew is retired without
--      deleting its history.
--   3. `crews_total` counts only crews that actually have somebody in them, and
--      a new `crews_empty` says how many active crews are stranded, so the
--      screen can report the problem instead of hiding it.
--
-- Deliberately NOT done: no rows are deleted and no membership is invented.
-- The existing empty crews stay empty; the supervisor is told, and fixes it.
-- Inventing a member would make the number look right by making the roster
-- wrong.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Hard cap: two members per crew
-- ----------------------------------------------------------------------------
-- BEFORE INSERT only. `upsert_crew` deletes and re-inserts the whole roster, so
-- a check on UPDATE would fire halfway through that cycle against a list that
-- is legitimately being rebuilt.
CREATE OR REPLACE FUNCTION public.enforce_crew_size()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.crew_members
  WHERE crew_id = NEW.crew_id;

  IF v_count >= 2 THEN
    RAISE EXCEPTION 'This crew already has two members. A crew is one or two people.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_crew_size() IS
  'A crew is a two-person vehicle. Rejects a third member on insert.';

DROP TRIGGER IF EXISTS trg_crew_size ON public.crew_members;
CREATE TRIGGER trg_crew_size
  BEFORE INSERT ON public.crew_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_crew_size();

-- ----------------------------------------------------------------------------
-- 2. `upsert_crew` validates the roster it is about to save
-- ----------------------------------------------------------------------------
-- Same signature as `001`, so every existing caller keeps working.
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
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_target_crew_id uuid;
  v_uid uuid;
  v_members int;
BEGIN
  v_caller := public.get_session_user(p_token);
  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage crews';
  END IF;

  -- Validate before writing anything, so a rejected save leaves no half-built
  -- roster behind.
  v_members := coalesce(array_length(p_member_ids, 1), 0);

  IF v_members > 2 THEN
    RAISE EXCEPTION 'A crew is one or two people, not %.', v_members
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_active AND v_members = 0 THEN
    RAISE EXCEPTION 'An active crew needs at least one member. Add a technician, or mark the crew inactive.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_crew_id IS NULL THEN
    INSERT INTO public.crews (group_id, name, vehicle_tag, zone_focus, is_active)
    VALUES (p_group_id, trim(p_name), NULLIF(trim(COALESCE(p_vehicle_tag, '')), ''), NULLIF(trim(COALESCE(p_zone_focus, '')), ''), p_is_active)
    RETURNING id INTO v_target_crew_id;
  ELSE
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
$$;

COMMENT ON FUNCTION public.upsert_crew(uuid, uuid, uuid, text, text, text, uuid[], boolean) IS
  'Create or update a crew. A crew is one or two people; an active crew must have at least one member.';

-- ----------------------------------------------------------------------------
-- 3. `today_summary`: count crews that can actually go out
-- ----------------------------------------------------------------------------
-- Replaced rather than edited in place — the same function name and signature,
-- so `fetchTodaySummary` is unaffected. Only the two crew keys change meaning,
-- and `crews_empty` is added.
CREATE OR REPLACE FUNCTION public.today_summary(
  p_token uuid,
  p_group_id uuid,
  p_day date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_day date;
  v_result jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  -- A supervisor only ever sees their own group; a manager may name any.
  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  v_day := COALESCE(p_day, (now() AT TIME ZONE 'UTC')::date);

  SELECT jsonb_build_object(
    'day', v_day,

    'open_now',     count(*) FILTER (WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')),
    'unassigned',   count(*) FILTER (WHERE t.status = 'unassigned'),
    'assigned',     count(*) FILTER (WHERE t.status = 'assigned'),
    'in_progress',  count(*) FILTER (WHERE t.status = 'in_progress'),
    'blocked',      count(*) FILTER (WHERE t.status = 'blocked'),

    'over_sla',     count(*) FILTER (
                      WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
                        AND coalesce(t.reported_date::timestamptz, t.created_at) < now() - interval '3 days'
                    ),

    -- At the promise rather than past it: reported three days ago, still open.
    -- The supervisor's chance to act before the department breaks its word.
    'due_today',    count(*) FILTER (
                      WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
                        AND coalesce(t.reported_date::timestamptz, t.created_at)::date
                            = (v_day - interval '3 days')::date
                    ),

    'created_today',   count(*) FILTER (WHERE t.created_at >= v_day::timestamptz AND t.created_at < (v_day + 1)::timestamptz),
    'completed_today', count(*) FILTER (WHERE t.completed_at >= v_day::timestamptz AND t.completed_at < (v_day + 1)::timestamptz)
  )
  INTO v_result
  FROM public.tasks t
  WHERE t.group_id = p_group_id;

  -- Who is out, counted from the work rather than from the roster: a crew with
  -- no running job is not "out", however many members it has.
  --
  -- `crews_total` now counts only crews that have somebody in them, because an
  -- empty crew cannot be sent anywhere and counting it inflates the
  -- denominator into a false picture of capacity.
  v_result := v_result || jsonb_build_object(
    'crews_out', (
      SELECT count(DISTINCT t.assigned_crew_id)
      FROM public.tasks t
      WHERE t.group_id = p_group_id AND t.status = 'in_progress' AND t.assigned_crew_id IS NOT NULL
    ),
    'crews_total', (
      SELECT count(*) FROM public.crews c
      WHERE c.group_id = p_group_id AND c.is_active
        AND EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.crew_id = c.id)
    ),
    'crews_empty', (
      SELECT count(*) FROM public.crews c
      WHERE c.group_id = p_group_id AND c.is_active
        AND NOT EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.crew_id = c.id)
    ),
    'people_out', (
      SELECT count(DISTINCT worker) FROM (
        SELECT t.assigned_user_id AS worker
        FROM public.tasks t
        WHERE t.group_id = p_group_id AND t.status = 'in_progress' AND t.assigned_user_id IS NOT NULL
        UNION
        SELECT cm.user_id
        FROM public.tasks t
        JOIN public.crew_members cm ON cm.crew_id = t.assigned_crew_id
        WHERE t.group_id = p_group_id AND t.status = 'in_progress'
      ) w
    ),
    'server_now', now()
  );

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.today_summary(uuid, uuid, date) IS
  'Operational counts for one day. crews_total counts active crews that have at least one member; crews_empty counts active crews that have nobody.';

GRANT EXECUTE ON FUNCTION public.today_summary(uuid, uuid, date) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- Rollback (run only if this needs reverting)
-- ============================================================================
--   DROP TRIGGER IF EXISTS trg_crew_size ON public.crew_members;
--   DROP FUNCTION IF EXISTS public.enforce_crew_size();
--   -- then re-run the `upsert_crew` and `today_summary` definitions from
--   -- 001_initial_schema.sql and 022_batch_i_today_summary.sql respectively.
--
-- Nothing here deletes data, so a rollback loses no rows.
-- ============================================================================
