-- ============================================================================
-- 021 — say how much of a number is demo
--
-- Batch F built the demo history and the Insights screen labels it: a banner,
-- "36 demo jobs are included in these numbers", and a one-tap removal. That
-- label lives in `ops_analytics`, and only there.
--
-- `period_report` and `manager_portfolio` count every task in the window,
-- demo rows included, and return no indication that they did. Load the demo
-- history and the printable period report says "44 created, 39 completed", the
-- manager's portfolio says the same 39, and neither has a word about the 36
-- synthetic jobs behind the number. A report that a head manager files is the
-- one document that must not be quietly fiction.
--
-- Why a separate function rather than an extra key in those two:
--
--   `period_report` is 5.7 kB of SQL and `manager_portfolio` 4.6 kB, both
--   SECURITY DEFINER, both already rewritten twice (012 → 013, 014). Replacing
--   either by hand to add one key is precisely the move that broke
--   `group_overview` in §17.2 — a valid jsonb object with the wrong keys, and
--   nothing fails loudly. An additive function cannot break a caller that does
--   not know about it.
--
-- The count is scoped the same way the screens are:
--   * a manager may ask about one group or about all of them
--   * anyone else may only ask about their own group
-- ============================================================================

CREATE OR REPLACE FUNCTION public.demo_summary(
  p_token uuid,
  p_group_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_scope uuid;
  v_tasks int := 0;
  v_demo int := 0;
  v_logs int := 0;
  v_logs_demo int := 0;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'manager' THEN
    v_scope := p_group_id;              -- NULL means every group
  ELSE
    IF p_group_id IS NOT NULL AND p_group_id <> v_caller.group_id THEN
      RAISE EXCEPTION 'Not allowed for this group';
    END IF;
    v_scope := v_caller.group_id;
  END IF;

  -- `created_at`, not `reported_date`.
  --
  -- `period_report` counts a job as created when it entered the system
  -- (`t.created_at >= v_from_ts AND t.created_at < v_to_ts`), because that is
  -- when the department learned about it. A label that used a different date
  -- basis would read "36 of 39 are demo" underneath a heading saying "44
  -- created" — two numbers that are individually right and together look like a
  -- bug. The label has to describe the number it is attached to.
  SELECT count(*) INTO v_tasks
  FROM public.tasks t
  WHERE (v_scope IS NULL OR t.group_id = v_scope)
    AND (p_from IS NULL OR t.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR t.created_at < (p_to + 1)::timestamptz);

  SELECT count(*) INTO v_demo
  FROM public.tasks t
  WHERE t.is_demo
    AND (v_scope IS NULL OR t.group_id = v_scope)
    AND (p_from IS NULL OR t.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR t.created_at < (p_to + 1)::timestamptz);

  SELECT count(*) INTO v_logs
  FROM public.cablebox_logs l
  JOIN public.cableboxes cb ON cb.id = l.cablebox_id
  WHERE (v_scope IS NULL OR cb.group_id = v_scope)
    AND (p_from IS NULL OR l.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR l.created_at < (p_to + 1)::timestamptz);

  SELECT count(*) INTO v_logs_demo
  FROM public.cablebox_logs l
  JOIN public.cableboxes cb ON cb.id = l.cablebox_id
  WHERE l.is_demo
    AND (v_scope IS NULL OR cb.group_id = v_scope)
    AND (p_from IS NULL OR l.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR l.created_at < (p_to + 1)::timestamptz);

  RETURN jsonb_build_object(
    'tasks', v_demo,
    'tasks_total', v_tasks,
    'logs', v_logs_demo,
    'logs_total', v_logs,
    'from', p_from,
    'to', p_to
  );
END;
$fn$;

COMMENT ON FUNCTION public.demo_summary(uuid, uuid, date, date) IS
  'How many tasks and cablebox events in a scope and window are demo rows. Used to label any screen whose numbers demo data can inflate.';

GRANT EXECUTE ON FUNCTION public.demo_summary(uuid, uuid, date, date) TO anon, authenticated;
