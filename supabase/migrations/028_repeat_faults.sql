-- ============================================================================
-- 028 — Repeat-fault escalation
-- ============================================================================
--
-- Which customers keep coming back, and with how many faults.
--
-- ## What "repeat" means here, and what it does not
--
-- A line is flagged when it has **three or more non-cancelled fault jobs
-- (`cilada`) reported within the window** (90 days by default). That is the
-- department's own rule: *three faults in ninety days*.
--
-- **"Repeat" never means "the same phone number appeared twice".** Two customers
-- can share a phone — a shop, a family, a borrowed handset. Identity is
-- `line_number`, because that is what the sheet keys on and what the customer
-- recognises on their own bill.
--
-- ## Why the count is not built on `is_repeat_fault`
--
-- The plan said to count jobs where `is_repeat_fault = true` **or**
-- `previous_task_id IS NOT NULL`. Inspection says that cannot work:
--
--   * the importer sets that flag only when a line comes back **after a
--     completed** job (`src/lib/importer.ts:188`) — so the first fault on a line
--     is never flagged;
--   * three real faults on one line therefore produce **two** flags, and the
--     escalation would need a fourth fault to fire — off by one, permanently;
--   * and it depends on timing: if the earlier job has not been completed at the
--     moment the next sheet is imported, the newer row is classified as a
--     carryover and never flagged at all.
--
-- Measured on the live project, 15/11/2026: `is_repeat_fault` is false and
-- `previous_task_id` is null on **all 28 tasks**. A rule built on those columns
-- would be dead code that looks like a feature.
--
-- So the count is of the faults themselves, which is both the department's rule
-- and a fact the data can support. `is_repeat_fault` is returned as
-- `flagged_repeats` — supporting evidence on the row, never the trigger.
--
-- ## Blank line numbers are excluded
--
-- A job whose `line_number` is empty cannot be attributed to a customer. Grouping
-- blanks together would make every anonymous job look like one customer with a
-- serial fault — the single worst false positive this screen could produce.
--
-- Rollback at the bottom: two functions, no table.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The watch list
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_fault_watch(
  p_token uuid,
  p_group_id uuid,
  p_days int DEFAULT 90,
  p_threshold int DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_days int := GREATEST(1, LEAST(COALESCE(p_days, 90), 365));
  -- A threshold of 1 would flag every fault ever reported, which is not an
  -- escalation — it is the job list. Two is the lowest defensible setting.
  v_threshold int := GREATEST(2, LEAST(COALESCE(p_threshold, 3), 20));
  v_from date := CURRENT_DATE - (GREATEST(1, LEAST(COALESCE(p_days, 90), 365)) - 1);
  v_lines jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'technician' THEN
    RAISE EXCEPTION 'Only a supervisor can see the repeat-fault watch list';
  END IF;

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  -- `(row->>'faults')::int`, not the raw text: jsonb numbers come back as text,
  -- and sorting text puts 10 below 9, so the worst line would not be first.
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'faults')::int DESC, row->>'last_fault_at' DESC), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT jsonb_build_object(
      'line_number', f.line_key,
      'customer_name', f.customer_name,
      'customer_phone', f.customer_phone,
      'xaafada', f.xaafada,
      'cablebox_code', f.cablebox_code,
      'faults', f.faults,
      'open_faults', f.open_faults,
      'last_fault_at', f.last_fault_at,
      -- How many of those faults carry the importer's "came back after a fix"
      -- flag. Shown as evidence beside the count, never used as the count.
      'flagged_repeats', f.flagged_repeats
    ) AS row
    FROM (
      SELECT
        lower(btrim(t.line_number)) AS line_key,
        count(*) AS faults,
        count(*) FILTER (
          WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')
        ) AS open_faults,
        max(t.reported_date) AS last_fault_at,
        count(*) FILTER (WHERE t.is_repeat_fault OR t.previous_task_id IS NOT NULL) AS flagged_repeats,
        -- The most recent value of each descriptive field, so the row describes
        -- the customer as they are now rather than as they were in the oldest job.
        (array_agg(t.customer_name ORDER BY COALESCE(t.reported_date, t.created_at::date) DESC)
          FILTER (WHERE t.customer_name IS NOT NULL))[1] AS customer_name,
        (array_agg(t.customer_phone ORDER BY COALESCE(t.reported_date, t.created_at::date) DESC)
          FILTER (WHERE t.customer_phone IS NOT NULL))[1] AS customer_phone,
        (array_agg(t.xaafada ORDER BY COALESCE(t.reported_date, t.created_at::date) DESC)
          FILTER (WHERE t.xaafada IS NOT NULL))[1] AS xaafada,
        (array_agg(t.cablebox_code_raw ORDER BY COALESCE(t.reported_date, t.created_at::date) DESC)
          FILTER (WHERE t.cablebox_code_raw IS NOT NULL))[1] AS cablebox_code
      FROM public.tasks t
      WHERE t.group_id = p_group_id
        AND t.task_type = 'cilada'
        AND t.status <> 'cancelled'
        -- An unattributable job must never be grouped with another.
        AND btrim(COALESCE(t.line_number, '')) <> ''
        AND COALESCE(t.reported_date, t.created_at::date) >= v_from
      GROUP BY 1
      HAVING count(*) >= v_threshold
    ) f
  ) s;

  RETURN jsonb_build_object(
    'from', v_from,
    'to', CURRENT_DATE,
    'days', v_days,
    'threshold', v_threshold,
    -- The window applies to when the fault was REPORTED (same rule as 027).
    'basis', 'reported',
    'lines', v_lines,
    'total_flagged', jsonb_array_length(v_lines)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.repeat_fault_watch(uuid, uuid, int, int) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. One job's line, for the job sheet
-- ----------------------------------------------------------------------------
-- Called when a technician or supervisor opens a job, so the count appears at
-- the moment it is useful — standing in front of the customer — rather than only
-- on a supervisor's screen.
--
-- Uses `get_task`, which already checks the session, the group and that the task
-- exists, so this cannot be used to read another group's history.
CREATE OR REPLACE FUNCTION public.repeat_fault_count(
  p_token uuid,
  p_task_id uuid,
  p_days int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_task public.tasks;
  v_days int := GREATEST(1, LEAST(COALESCE(p_days, 90), 365));
  v_from date := CURRENT_DATE - (GREATEST(1, LEAST(COALESCE(p_days, 90), 365)) - 1);
  v_key text;
  v_faults int := 0;
  v_jobs jsonb;
BEGIN
  v_task := public.get_task(p_token, p_task_id);

  v_key := lower(btrim(COALESCE(v_task.line_number, '')));

  -- No line number, no claim. Reporting zero rather than guessing is the whole
  -- point of this migration's opening note.
  IF v_key = '' THEN
    RETURN jsonb_build_object(
      'line_number', NULL,
      'faults', 0,
      'threshold', 3,
      'days', v_days,
      'from', v_from,
      'to', CURRENT_DATE,
      'investigate', false,
      'known', false,
      'jobs', '[]'::jsonb
    );
  END IF;

  SELECT
    count(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', j.id,
          'reported_date', j.reported_date,
          'status', j.status,
          'is_repeat_fault', j.is_repeat_fault
        )
        ORDER BY j.reported_date DESC NULLS LAST
      ),
      '[]'::jsonb
    )
  INTO v_faults, v_jobs
  FROM (
    SELECT t.id, t.reported_date, t.status, t.is_repeat_fault
    FROM public.tasks t
    WHERE t.group_id = v_task.group_id
      AND t.task_type = 'cilada'
      AND t.status <> 'cancelled'
      AND lower(btrim(COALESCE(t.line_number, ''))) = v_key
      AND COALESCE(t.reported_date, t.created_at::date) >= v_from
    ORDER BY t.reported_date DESC NULLS LAST
    LIMIT 20
  ) j;

  RETURN jsonb_build_object(
    'line_number', v_task.line_number,
    'faults', v_faults,
    'threshold', 3,
    'days', v_days,
    'from', v_from,
    'to', CURRENT_DATE,
    'investigate', v_faults >= 3,
    'known', true,
    'jobs', v_jobs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.repeat_fault_count(uuid, uuid, int) TO anon, authenticated;


-- ============================================================================
-- Rollback
-- ============================================================================
--
--   DROP FUNCTION IF EXISTS public.repeat_fault_count(uuid, uuid, int);
--   DROP FUNCTION IF EXISTS public.repeat_fault_watch(uuid, uuid, int, int);
--
-- Nothing is created, altered or stored. No task changes, no flag is written:
-- the count is recomputed on every call, so a rollback loses no data at all.
-- ============================================================================
