-- ============================================================================
-- Migration 004 — Supervisor dispatch & route clustering
--
--   * assign_tasks / unassign_tasks: atomic, supervisor-only, audited. A job
--     that is already in progress or completed is never silently re-dispatched;
--     it comes back as "skipped" with the reason.
--   * dispatch_log: what was sent to the group chat, by whom and when, so the
--     morning message can be re-printed or audited later.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Allow "unassigned" in the work log
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_work_logs_action_check'
      AND conrelid = 'public.task_work_logs'::regclass
  ) THEN
    ALTER TABLE public.task_work_logs DROP CONSTRAINT task_work_logs_action_check;
  END IF;

  ALTER TABLE public.task_work_logs
    ADD CONSTRAINT task_work_logs_action_check
    CHECK (action IN (
      'imported', 'assigned', 'unassigned', 'started', 'paused',
      'blocked', 'resumed', 'completed', 'reopened'
    ));
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Dispatch log (one row per group-chat message that was generated)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'clipboard'
    CHECK (channel IN ('clipboard', 'share', 'whatsapp', 'telegram')),
  task_count int NOT NULL DEFAULT 0,
  crew_count int NOT NULL DEFAULT 0,
  message text NOT NULL,
  task_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_group_time
  ON public.dispatch_log(group_id, created_at DESC);

ALTER TABLE public.dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read dispatch_log" ON public.dispatch_log;
CREATE POLICY "Allow read dispatch_log" ON public.dispatch_log FOR SELECT USING (true);

-- ----------------------------------------------------------------------------
-- 3. assign_tasks — one technician OR one crew, many jobs, one transaction
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_tasks(
  p_token uuid,
  p_group_id uuid,
  p_task_ids uuid[],
  p_user_id uuid DEFAULT NULL,
  p_crew_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_label text;
  v_id uuid;
  v_task public.tasks;
  v_assigned int := 0;
  v_skipped int := 0;
  v_detail jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can dispatch work';
  END IF;

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  IF (p_user_id IS NULL) = (p_crew_id IS NULL) THEN
    RAISE EXCEPTION 'Choose exactly one technician or one crew';
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT full_name INTO v_label
    FROM public.users
    WHERE id = p_user_id AND group_id = p_group_id AND is_active = true;

    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Technician not found in this group';
    END IF;
  ELSE
    SELECT name INTO v_label
    FROM public.crews
    WHERE id = p_crew_id AND group_id = p_group_id AND is_active = true;

    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Crew not found in this group';
    END IF;
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_task_ids, '{}'::uuid[])
  LOOP
    v_task := NULL;
    SELECT * INTO v_task FROM public.tasks WHERE id = v_id FOR UPDATE;

    IF v_task.id IS NULL OR v_task.group_id <> p_group_id THEN
      v_reason := 'not_found';
    ELSIF v_task.status = 'in_progress' THEN
      v_reason := 'in_progress';
    ELSIF v_task.status = 'completed' THEN
      v_reason := 'completed';
    ELSE
      v_reason := NULL;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_detail := v_detail || jsonb_build_object('id', v_id, 'reason', v_reason);
      CONTINUE;
    END IF;

    UPDATE public.tasks
    SET status = 'assigned',
        assigned_user_id = p_user_id,
        assigned_crew_id = p_crew_id,
        assigned_by = v_caller.id,
        assigned_at = now(),
        updated_at = now()
    WHERE id = v_id;

    -- A blocked job may be re-dispatched (fiber break, wrong crew…), but the
    -- reason it was blocked must survive in the history.
    INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
    VALUES (
      v_id,
      v_caller.id,
      'assigned',
      CASE
        WHEN v_task.status = 'blocked'
          THEN v_label || ' (was blocked: ' || COALESCE(v_task.blocker_reason, 'other') || ')'
        ELSE v_label
      END
    );

    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'assigned', v_assigned,
    'skipped', v_skipped,
    'skipped_detail', v_detail,
    'target', v_label,
    'user_id', p_user_id,
    'crew_id', p_crew_id
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. unassign_tasks — return jobs to the pool (never touches started work)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unassign_tasks(
  p_token uuid,
  p_group_id uuid,
  p_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_id uuid;
  v_task public.tasks;
  v_released int := 0;
  v_skipped int := 0;
  v_detail jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can dispatch work';
  END IF;

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_task_ids, '{}'::uuid[])
  LOOP
    v_task := NULL;
    SELECT * INTO v_task FROM public.tasks WHERE id = v_id FOR UPDATE;

    IF v_task.id IS NULL OR v_task.group_id <> p_group_id THEN
      v_reason := 'not_found';
    ELSIF v_task.status <> 'assigned' THEN
      v_reason := v_task.status;
    ELSE
      v_reason := NULL;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_detail := v_detail || jsonb_build_object('id', v_id, 'reason', v_reason);
      CONTINUE;
    END IF;

    UPDATE public.tasks
    SET status = 'unassigned',
        assigned_user_id = NULL,
        assigned_crew_id = NULL,
        assigned_by = NULL,
        assigned_at = NULL,
        updated_at = now()
    WHERE id = v_id;

    INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
    VALUES (v_id, v_caller.id, 'unassigned', 'Returned to the unassigned pool');

    v_released := v_released + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'released', v_released,
    'skipped', v_skipped,
    'skipped_detail', v_detail
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. log_dispatch — record the group-chat message
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_dispatch(
  p_token uuid,
  p_group_id uuid,
  p_channel text,
  p_message text,
  p_task_ids uuid[],
  p_crew_count int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_id uuid;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  INSERT INTO public.dispatch_log (
    group_id, sent_by, channel, task_count, crew_count, message, task_ids
  ) VALUES (
    p_group_id,
    v_caller.id,
    COALESCE(NULLIF(p_channel, ''), 'clipboard'),
    COALESCE(array_length(p_task_ids, 1), 0),
    GREATEST(COALESCE(p_crew_count, 0), 0),
    COALESCE(p_message, ''),
    COALESCE(p_task_ids, '{}'::uuid[])
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Load per technician / crew (used by the dispatch board)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_load(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_users jsonb;
  v_crews jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.group_id <> p_group_id THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.full_name), '[]'::jsonb)
  INTO v_users
  FROM (
    SELECT
      u.id,
      u.full_name,
      u.username,
      u.phone,
      COUNT(t.id) FILTER (WHERE t.status IN ('assigned', 'in_progress')) AS open_jobs,
      COUNT(t.id) FILTER (WHERE t.status = 'in_progress') AS active_jobs,
      COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= CURRENT_DATE) AS done_today,
      COUNT(t.id) FILTER (
        WHERE t.status IN ('assigned', 'in_progress') AND t.priority = 'urgent'
      ) AS urgent_jobs
    FROM public.users u
    LEFT JOIN public.tasks t
      ON t.assigned_user_id = u.id AND t.group_id = u.group_id
    WHERE u.group_id = p_group_id AND u.role = 'technician' AND u.is_active = true
    GROUP BY u.id, u.full_name, u.username, u.phone
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.name), '[]'::jsonb)
  INTO v_crews
  FROM (
    SELECT
      cr.id,
      cr.name,
      cr.vehicle_tag,
      cr.zone_focus,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'full_name', m.full_name)), '[]'::jsonb)
        FROM public.crew_members cm
        JOIN public.users m ON m.id = cm.user_id
        WHERE cm.crew_id = cr.id
      ) AS members,
      COUNT(t.id) FILTER (WHERE t.status IN ('assigned', 'in_progress')) AS open_jobs,
      COUNT(t.id) FILTER (WHERE t.status = 'in_progress') AS active_jobs,
      COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= CURRENT_DATE) AS done_today,
      COUNT(t.id) FILTER (
        WHERE t.status IN ('assigned', 'in_progress') AND t.priority = 'urgent'
      ) AS urgent_jobs
    FROM public.crews cr
    LEFT JOIN public.tasks t ON t.assigned_crew_id = cr.id AND t.group_id = cr.group_id
    WHERE cr.group_id = p_group_id AND cr.is_active = true
    GROUP BY cr.id, cr.name, cr.vehicle_tag, cr.zone_focus
  ) c;

  RETURN jsonb_build_object('users', v_users, 'crews', v_crews);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_tasks(uuid, uuid, uuid[], uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_tasks(uuid, uuid, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_dispatch(uuid, uuid, text, text, uuid[], int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_load(uuid, uuid) TO anon, authenticated;
