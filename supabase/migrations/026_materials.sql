-- ============================================================================
-- 026 — Materials used on a job
-- ============================================================================
--
-- What a job consumed: how many metres of drop cable, how many connectors, how
-- many routers.
--
-- ## Usage, not stock — and this is a deliberate limit
--
-- The tempting feature is "how many routers are left in the store". It cannot
-- be built honestly from what this system holds. A stock figure is
-- `received − used`, and **nothing records a delivery**. Computing
-- `0 − used` produces a negative number that drifts further from the shelf every
-- week, and a supervisor would eventually reorder against it.
--
-- So this table records what was **used**, which is a fact and can be reconciled
-- against the store's paperwork by a person. Every screen built on it says
-- "usage", and there is no stock column to be mistaken for one.
--
-- If stock-on-hand is ever wanted, it needs a `material_deliveries` table and a
-- person to record arrivals. That is a later decision, not a missing column.
--
-- ## Privacy posture
--
-- Same as `task_photos` (013): RLS on with **no policies**, so the table is
-- unreachable with the anon key that ships in the browser. Everything goes
-- through the token-checked functions below.
--
-- Rollback is at the bottom.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 80),
  quantity numeric NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
  unit text NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs', 'm', 'roll', 'box')),
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_materials IS
  'Materials consumed on a job. Usage only — there is no stock figure, because nothing records deliveries. Private: reachable only through the functions below.';

CREATE INDEX IF NOT EXISTS idx_task_materials_task
  ON public.task_materials (task_id);

-- The reporting query filters by group and a date window, so it needs its own
-- index rather than a scan of every line ever recorded.
CREATE INDEX IF NOT EXISTS idx_task_materials_group_created
  ON public.task_materials (group_id, created_at DESC);

ALTER TABLE public.task_materials ENABLE ROW LEVEL SECURITY;
-- No policies on purpose — the table is reachable only through the functions below.

REVOKE ALL ON public.task_materials FROM anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Record a line
-- ----------------------------------------------------------------------------
-- Allowed for whoever may act on the job (`is_task_worker`): the technician, a
-- member of the assigned crew, or a supervisor correcting it later. A crew job
-- is worked from one phone between two people, and whoever finishes it records
-- what was used.
--
-- Deliberately allowed on a **completed** job. Materials are usually recorded at
-- completion, but the shop is counted the next morning and a missing line is
-- discovered then. Refusing the correction would leave the record permanently
-- short, which is worse than a late entry with a timestamp on it.
CREATE OR REPLACE FUNCTION public.add_task_material(
  p_token uuid,
  p_task_id uuid,
  p_item text,
  p_quantity numeric,
  p_unit text DEFAULT 'pcs'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_task public.tasks;
  v_item text;
  v_row public.task_materials;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND group_id = v_caller.group_id;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Job not found in this group';
  END IF;

  IF public.is_task_worker(v_caller, v_task) IS NOT TRUE THEN
    RAISE EXCEPTION 'This job is not assigned to you';
  END IF;

  v_item := regexp_replace(btrim(COALESCE(p_item, '')), '\s+', ' ', 'g');
  IF v_item = '' THEN
    RAISE EXCEPTION 'An item is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Quantity must be between 0 and 10000';
  END IF;

  IF COALESCE(p_unit, 'pcs') NOT IN ('pcs', 'm', 'roll', 'box') THEN
    RAISE EXCEPTION 'Unknown unit';
  END IF;

  INSERT INTO public.task_materials (group_id, task_id, item, quantity, unit, recorded_by)
  VALUES (v_task.group_id, v_task.id, v_item, round(p_quantity, 2), COALESCE(p_unit, 'pcs'), v_caller.id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'material', to_jsonb(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_task_material(uuid, uuid, text, numeric, text) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Read a job's materials
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_task_materials(p_token uuid, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_task public.tasks;
  v_rows jsonb;
BEGIN
  -- `get_task` already checks the session, the group and the task's existence,
  -- so this cannot be used to read another group's data.
  v_task := public.get_task(p_token, p_task_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'item', m.item,
        'quantity', m.quantity,
        'unit', m.unit,
        'recorded_by_name', u.full_name,
        'created_at', m.created_at
      )
      ORDER BY m.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.task_materials m
  LEFT JOIN public.users u ON u.id = m.recorded_by
  WHERE m.task_id = v_task.id;

  RETURN jsonb_build_object('task_id', v_task.id, 'materials', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_task_materials(uuid, uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. Usage in a period
-- ----------------------------------------------------------------------------
-- Grouped by item **and unit**, because six metres of cable and six connectors
-- cannot be added together. The client aggregates the same way; this does it in
-- SQL so a period with thousands of lines does not ship them to a phone.
--
-- `jobs` is the number of distinct jobs, which a plain sum hides: one job using
-- three connectors is a different problem from three jobs using one each.
CREATE OR REPLACE FUNCTION public.materials_usage(
  p_token uuid,
  p_group_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_rows jsonb;
  v_from date := COALESCE(p_from, CURRENT_DATE - 30);
  v_to date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'technician' THEN
    RAISE EXCEPTION 'Only a supervisor can see group-wide materials';
  END IF;

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  IF v_to < v_from THEN
    RAISE EXCEPTION 'The end date is before the start date';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item', s.item,
        'unit', s.unit,
        'quantity', s.quantity,
        'jobs', s.jobs
      )
      ORDER BY s.quantity DESC, s.item ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT
      m.item,
      m.unit,
      round(sum(m.quantity), 2) AS quantity,
      count(DISTINCT m.task_id) AS jobs
    FROM public.task_materials m
    WHERE m.group_id = p_group_id
      AND m.created_at >= v_from::timestamptz
      AND m.created_at < (v_to + 1)::timestamptz
    GROUP BY m.item, m.unit
  ) s;

  RETURN jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'rows', v_rows,
    -- Stated in the payload as well as on the screen, so a future caller cannot
    -- mistake this for a stock report without contradicting the server.
    'basis', 'usage'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.materials_usage(uuid, uuid, date, date) TO anon, authenticated;


-- ============================================================================
-- Rollback
-- ============================================================================
--
--   DROP FUNCTION IF EXISTS public.materials_usage(uuid, uuid, date, date);
--   DROP FUNCTION IF EXISTS public.list_task_materials(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.add_task_material(uuid, uuid, text, numeric, text);
--   DROP TABLE IF EXISTS public.task_materials;
--
-- Dropping the table loses the record of what each job consumed. Nothing else
-- references it — job statuses, durations, dBm readings, photos and completion
-- times are untouched, so the operational record survives intact and only the
-- materials figures are lost.
-- ============================================================================
