-- ============================================================================
-- 030 — Customer job history for a line
-- ============================================================================
--
-- Before a technician is sent to a fault, somebody has usually been there
-- before. This answers "what has happened on this line" — the dates, the type,
-- the outcome, the dBm reading and who did it.
--
-- ## Why the line number and not the customer name
--
-- The sheet's own key is `line_number`. Names are typed from a photo and vary
-- between sheets ("Cabdi Xasan" / "Cabdi Xasan Nuur"), so grouping on a name
-- splits one customer into two. The line is what the department recognises and
-- what the customer reads off their own bill.
--
-- `previous_task_id` is honoured **in addition to** the line match, never
-- instead of it: a carryover that was re-keyed under a different line number
-- would otherwise vanish from the history.
--
-- ## Why cancelled jobs are included
--
-- A cancelled fault is part of what happened on that line — it usually means
-- somebody visited and found nothing, or the customer withdrew. Hiding it makes
-- the history look shorter than the customer's memory of it. The status is shown
-- so nobody has to guess.
--
-- ## Read-only
--
-- No table, no trigger, no write. The rollback is a single DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.line_history(
  p_token uuid,
  p_group_id uuid,
  p_line_number text,
  p_exclude_task_id uuid DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_key text := lower(btrim(COALESCE(p_line_number, '')));
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
  v_prev uuid;
  v_jobs jsonb;
  v_total int := 0;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  -- An empty line number matches nothing. Returning the whole group's history
  -- for a job that has no line would be the worst possible reading.
  IF v_key = '' THEN
    RETURN jsonb_build_object(
      'line_number', NULL,
      'found', false,
      'jobs', '[]'::jsonb,
      'total', 0
    );
  END IF;

  -- The carryover link of the job being looked at, if there is one.
  IF p_exclude_task_id IS NOT NULL THEN
    SELECT t.previous_task_id INTO v_prev
    FROM public.tasks t
    WHERE t.id = p_exclude_task_id
      AND t.group_id = p_group_id;
  END IF;

  SELECT
    count(*),
    COALESCE(
      jsonb_agg(to_jsonb(j) ORDER BY j.sort_date DESC NULLS LAST, j.created_at DESC),
      '[]'::jsonb
    )
  INTO v_total, v_jobs
  FROM (
    SELECT
      t.id,
      t.reported_date,
      t.sort_date,
      t.created_at,
      t.task_type,
      t.status,
      t.optical_dbm,
      t.xaafada,
      t.cablebox_code_raw,
      t.completion_notes,
      t.cancel_reason,
      -- Two crews may share a name; the id is not shown, the name is enough.
      u.full_name AS technician,
      (t.id = p_exclude_task_id) AS is_current
    FROM (
      SELECT
        t.id,
        t.reported_date,
        COALESCE(t.reported_date, t.created_at::date) AS sort_date,
        t.created_at,
        t.task_type,
        t.status,
        t.optical_dbm,
        t.xaafada,
        t.cablebox_code_raw,
        t.completion_notes,
        t.cancel_reason,
        t.completed_by,
        t.created_by
      FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND lower(btrim(COALESCE(t.line_number, ''))) = v_key
        AND (p_exclude_task_id IS NULL OR t.id <> p_exclude_task_id)
      UNION
      -- The carryover this job was linked to, even if its line number differs.
      SELECT
        t.id,
        t.reported_date,
        COALESCE(t.reported_date, t.created_at::date),
        t.created_at,
        t.task_type,
        t.status,
        t.optical_dbm,
        t.xaafada,
        t.cablebox_code_raw,
        t.completion_notes,
        t.cancel_reason,
        t.completed_by,
        t.created_by
      FROM public.tasks t
      WHERE v_prev IS NOT NULL
        AND t.group_id = p_group_id
        AND t.id = v_prev
        AND t.id <> COALESCE(p_exclude_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) t
    LEFT JOIN public.users u ON u.id = COALESCE(t.completed_by, t.created_by)
    ORDER BY sort_date DESC NULLS LAST, t.created_at DESC
    LIMIT v_limit
  ) j;

  RETURN jsonb_build_object(
    'line_number', btrim(p_line_number),
    'found', v_total > 0,
    'jobs', v_jobs,
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.line_history(uuid, uuid, text, uuid, int) TO anon, authenticated;

-- ============================================================================
-- Rollback
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.line_history(uuid, uuid, text, uuid, int);
--
-- Nothing is created, altered or stored. No task is modified.
-- ============================================================================
