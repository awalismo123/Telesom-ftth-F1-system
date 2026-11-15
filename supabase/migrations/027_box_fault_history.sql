-- ============================================================================
-- 027 — Equipment-box fault history
-- ============================================================================
--
-- Which box keeps breaking, over a window the supervisor chooses.
--
-- ## Why not `cableboxes.fault_count`
--
-- That column exists and is incremented on completion (005, 007). It is a
-- **lifetime** counter: it cannot answer "how many faults this month", and it
-- cannot be reset without losing the history behind it. A box that failed 40
-- times in 2024 and has been fine since would outrank one that failed five times
-- last week.
--
-- So the window is computed from `tasks` at query time. Nothing is stored, so
-- nothing can drift, and the same numbers can be recomputed for any window.
--
-- ## Why `reported_date`, not `completed_at`
--
-- The plan said `completed_at`. That is wrong for this question: a box with five
-- faults reported this week and none fixed yet is the *worst* box in the group,
-- and `completed_at` would score it zero. A fault is evidence the moment it is
-- reported. Cancelled faults are excluded, because a cancelled job is a mistake
-- or a customer request, not evidence about the hardware.
--
-- The output says `basis: 'reported'` so a caller cannot mistake the window for
-- something else.
--
-- ## Why the box is resolved two ways
--
-- `tasks.cablebox_id` is the foreign key, but imports carry
-- `cablebox_code_raw` as text and the FK is not always filled — measured on the
-- live project: **zero of eight tasks have either**. Grouping only by the FK
-- would put every job in a single "no box" bucket and the leaderboard would look
-- broken.
--
-- So a task is attributed to a box by the FK when present, and otherwise by
-- matching the raw code to `cableboxes.box_code` (case- and space-insensitive,
-- because a sheet is typed by a human). Work that matches neither is counted in
-- a separate `unassigned` total rather than dropped — a total that silently
-- discards rows is worse than one that admits it does not know.
--
-- Rollback at the bottom. No table is created or altered.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.box_fault_history(
  p_token uuid,
  p_group_id uuid,
  p_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_days int := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_from date := CURRENT_DATE - (GREATEST(1, LEAST(COALESCE(p_days, 30), 365)) - 1);
  v_boxes jsonb;
  v_unassigned int;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role = 'technician' THEN
    RAISE EXCEPTION 'Only a supervisor can see box history';
  END IF;

  IF v_caller.role <> 'manager' AND v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'box_id', b.id,
        'box_code', b.box_code,
        'xaafada', b.xaafada,
        'health_status', b.health_status,
        'faults', COALESCE(f.faults, 0),
        'open_faults', COALESCE(f.open_faults, 0),
        'last_fault_at', f.last_fault_at
      )
      ORDER BY COALESCE(f.faults, 0) DESC, b.box_code ASC
    ),
    '[]'::jsonb
  )
  INTO v_boxes
  FROM public.cableboxes b
  LEFT JOIN (
    SELECT
      COALESCE(
        t.cablebox_id,
        (
          SELECT cb.id
          FROM public.cableboxes cb
          WHERE cb.group_id = t.group_id
            AND lower(btrim(cb.box_code)) = lower(btrim(t.cablebox_code_raw))
          LIMIT 1
        )
      ) AS resolved_box,
      count(*) AS faults,
      count(*) FILTER (WHERE t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')) AS open_faults,
      max(t.reported_date) AS last_fault_at
    FROM public.tasks t
    WHERE t.group_id = p_group_id
      AND t.task_type = 'cilada'
      AND t.status <> 'cancelled'
      AND COALESCE(t.reported_date, t.created_at::date) >= v_from
    GROUP BY 1
  ) f ON f.resolved_box = b.id
  WHERE b.group_id = p_group_id;

  -- Faults in the window that name no box we know about. Reported, not hidden:
  -- if this number is large, the import is losing box references and the
  -- leaderboard above is understating every box.
  SELECT count(*)
  INTO v_unassigned
  FROM public.tasks t
  WHERE t.group_id = p_group_id
    AND t.task_type = 'cilada'
    AND t.status <> 'cancelled'
    AND COALESCE(t.reported_date, t.created_at::date) >= v_from
    AND COALESCE(
      t.cablebox_id,
      (
        SELECT cb.id
        FROM public.cableboxes cb
        WHERE cb.group_id = t.group_id
          AND lower(btrim(cb.box_code)) = lower(btrim(t.cablebox_code_raw))
        LIMIT 1
      )
    ) IS NULL;

  RETURN jsonb_build_object(
    'from', v_from,
    'to', CURRENT_DATE,
    'days', v_days,
    -- Which date the window was applied to. Reported faults, not completed ones.
    'basis', 'reported',
    'boxes', v_boxes,
    'unassigned_faults', v_unassigned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.box_fault_history(uuid, uuid, int) TO anon, authenticated;


-- ============================================================================
-- Rollback
-- ============================================================================
--
--   DROP FUNCTION IF EXISTS public.box_fault_history(uuid, uuid, int);
--
-- Nothing is created, altered or stored. `cableboxes.fault_count` is untouched
-- and continues to hold the lifetime count it always held.
-- ============================================================================
