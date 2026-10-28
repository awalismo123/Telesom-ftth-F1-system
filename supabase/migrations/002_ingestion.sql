-- ============================================================================
-- Migration 002 — Daily sheet ingestion (Module 1)
--   * dedup keys + repeat-fault links on tasks
--   * batch status / decision audit on import_batches
--   * atomic commit + undo RPCs used by the import wizard
--   * private storage bucket for the source pictures
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS dedup_key text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS previous_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS complain_type text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS router_state text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_urgent boolean NOT NULL DEFAULT false;

ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'committed';
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS decision_summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS source_image_path text;
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS undone_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_dedup ON public.tasks(group_id, task_type, line_number);
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON public.tasks(import_batch_id);

-- ----------------------------------------------------------------------------
-- 2. Cablebox find-or-create helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_cablebox(
  p_group_id uuid,
  p_box_code text,
  p_xaafada text DEFAULT NULL,
  p_olt_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text := upper(regexp_replace(trim(p_box_code), '\s+', ' ', 'g'));
  v_id uuid;
BEGIN
  IF v_code IS NULL OR v_code = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.cableboxes WHERE box_code = v_code LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.cableboxes (group_id, box_code, xaafada, olt_path, health_status)
    VALUES (p_group_id, v_code, NULLIF(trim(COALESCE(p_xaafada, '')), ''), NULLIF(trim(COALESCE(p_olt_path, '')), ''), 'healthy')
    ON CONFLICT (box_code) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.cableboxes
    SET xaafada = COALESCE(NULLIF(trim(COALESCE(p_xaafada, '')), ''), xaafada),
        olt_path = COALESCE(NULLIF(trim(COALESCE(p_olt_path, '')), ''), olt_path),
        updated_at = now()
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. commit_import_batch — single transaction for the whole wizard result
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_import_batch(
  p_token uuid,
  p_group_id uuid,
  p_sheet_category text,
  p_source_type text,
  p_file_name text,
  p_print_date date,
  p_source_image_path text,
  p_summary jsonb,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_batch_id uuid;
  v_row jsonb;
  v_task jsonb;
  v_action text;
  v_existing_id uuid;
  v_before jsonb;
  v_created int := 0;
  v_refreshed int := 0;
  v_reopened int := 0;
  v_skipped int := 0;
  v_box_id uuid;
  v_new_task_id uuid;
  v_refreshed_log jsonb := '[]'::jsonb;
  v_created_ids uuid[] := '{}';
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can import daily sheets';
  END IF;

  IF p_group_id IS NOT NULL AND v_caller.group_id <> p_group_id AND v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  INSERT INTO public.import_batches (
    group_id, imported_by, sheet_category, source_type, file_name, print_date,
    total_rows_read, group_matched_rows, new_tasks_created, duplicates_skipped,
    carryovers_updated, source_image_path, decision_summary
  ) VALUES (
    p_group_id, v_caller.id, p_sheet_category, p_source_type, p_file_name, p_print_date,
    COALESCE((p_summary->>'total_rows_read')::int, 0),
    COALESCE((p_summary->>'group_matched_rows')::int, 0),
    0, 0, 0, p_source_image_path, p_summary
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_action := COALESCE(v_row->>'action', 'skip');
    v_task := v_row->'task';
    v_existing_id := NULLIF(v_row->>'existing_task_id', '')::uuid;

    IF v_action = 'skip' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_box_id := public.ensure_cablebox(
      p_group_id,
      COALESCE(v_task->>'cablebox_code', ''),
      v_task->>'xaafada',
      v_task->>'olt_path'
    );

    IF v_action = 'create' THEN
      INSERT INTO public.tasks (
        group_id, import_batch_id, sheet_row_id, task_type, line_number,
        customer_name, customer_phone, x_number, router_state, disc_code,
        service_type, work_subtype, speed_plan, xaafada,
        cablebox_code_raw, cablebox_id, port_number,
        reported_date, reported_time, priority, is_urgent, complain_type,
        is_repeat_fault, previous_task_id, status, scheduled_date,
        last_seen_on_sheet_date, dedup_key
      ) VALUES (
        p_group_id, v_batch_id,
        NULLIF(v_task->>'sheet_row_id', '')::int,
        p_sheet_category,
        COALESCE(v_task->>'line_number', ''),
        COALESCE(v_task->>'customer_name', 'Unknown'),
        NULLIF(v_task->>'customer_phone', ''),
        NULLIF(v_task->>'x_number', ''),
        NULLIF(v_task->>'router_state', ''),
        NULLIF(v_task->>'disc_code', ''),
        COALESCE(NULLIF(v_task->>'service_type', ''), 'Fiber'),
        NULLIF(v_task->>'work_subtype', ''),
        NULLIF(v_task->>'speed_plan', ''),
        NULLIF(v_task->>'xaafada', ''),
        NULLIF(v_task->>'cablebox_code', ''),
        v_box_id,
        NULLIF(v_task->>'port_number', '')::int,
        NULLIF(v_task->>'reported_date', '')::date,
        NULLIF(v_task->>'reported_time', ''),
        COALESCE(NULLIF(v_task->>'priority', ''), 'normal'),
        COALESCE((v_task->>'is_urgent')::boolean, false),
        NULLIF(v_task->>'complain_type', ''),
        COALESCE((v_task->>'is_repeat_fault')::boolean, false),
        NULLIF(v_task->>'previous_task_id', '')::uuid,
        'unassigned',
        COALESCE(NULLIF(v_task->>'scheduled_date', '')::date, CURRENT_DATE),
        CURRENT_DATE,
        p_sheet_category || ':' || COALESCE(v_task->>'line_number', '')
      )
      RETURNING id INTO v_new_task_id;

      v_created_ids := array_append(v_created_ids, v_new_task_id);

      INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
      VALUES (v_new_task_id, v_caller.id, 'imported',
              'Imported from ' || p_source_type || ' (' || p_sheet_category || ')');

      v_created := v_created + 1;

    ELSIF v_action IN ('refresh', 'reopen') AND v_existing_id IS NOT NULL THEN
      SELECT to_jsonb(t) INTO v_before FROM public.tasks t WHERE t.id = v_existing_id;

      UPDATE public.tasks SET
        customer_name = COALESCE(NULLIF(v_task->>'customer_name', ''), customer_name),
        customer_phone = COALESCE(NULLIF(v_task->>'customer_phone', ''), customer_phone),
        x_number = COALESCE(NULLIF(v_task->>'x_number', ''), x_number),
        router_state = COALESCE(NULLIF(v_task->>'router_state', ''), router_state),
        xaafada = COALESCE(NULLIF(v_task->>'xaafada', ''), xaafada),
        cablebox_code_raw = COALESCE(NULLIF(v_task->>'cablebox_code', ''), cablebox_code_raw),
        cablebox_id = COALESCE(v_box_id, cablebox_id),
        port_number = COALESCE(NULLIF(v_task->>'port_number', '')::int, port_number),
        work_subtype = COALESCE(NULLIF(v_task->>'work_subtype', ''), work_subtype),
        speed_plan = COALESCE(NULLIF(v_task->>'speed_plan', ''), speed_plan),
        complain_type = COALESCE(NULLIF(v_task->>'complain_type', ''), complain_type),
        is_urgent = COALESCE((v_task->>'is_urgent')::boolean, is_urgent),
        priority = CASE WHEN COALESCE((v_task->>'is_urgent')::boolean, false) THEN 'urgent' ELSE priority END,
        last_seen_on_sheet_date = CURRENT_DATE,
        import_batch_id = COALESCE(import_batch_id, v_batch_id),
        updated_at = now()
      WHERE id = v_existing_id;

      IF v_action = 'reopen' THEN
        UPDATE public.tasks SET
          status = 'unassigned',
          completed_at = NULL,
          completed_by = NULL,
          optical_dbm = NULL,
          completion_notes = NULL,
          blocker_reason = NULL,
          blocker_notes = NULL,
          blocked_at = NULL,
          active_started_at = NULL,
          accumulated_seconds = 0,
          is_repeat_fault = true,
          previous_task_id = v_existing_id,
          scheduled_date = CURRENT_DATE
        WHERE id = v_existing_id;

        INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
        VALUES (v_existing_id, v_caller.id, 'reopened', 'Reopened from daily sheet import');

        v_reopened := v_reopened + 1;
      ELSE
        INSERT INTO public.task_work_logs (task_id, user_id, action, notes)
        VALUES (v_existing_id, v_caller.id, 'imported', 'Refreshed from daily sheet import');

        v_refreshed := v_refreshed + 1;
      END IF;

      v_refreshed_log := v_refreshed_log || jsonb_build_array(
        jsonb_build_object('task_id', v_existing_id, 'before', v_before)
      );
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  UPDATE public.import_batches SET
    new_tasks_created = v_created,
    duplicates_skipped = v_skipped,
    carryovers_updated = v_refreshed + v_reopened,
    decision_summary = COALESCE(decision_summary, '{}'::jsonb) || jsonb_build_object(
      'refreshed', v_refreshed_log,
      'created_ids', to_jsonb(v_created_ids),
      'reopened', v_reopened,
      'refreshed_count', v_refreshed,
      'skipped', v_skipped
    )
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'created', v_created,
    'refreshed', v_refreshed,
    'reopened', v_reopened,
    'skipped', v_skipped
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. undo_import_batch
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_import_batch(p_token uuid, p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_batch public.import_batches;
  v_deleted int := 0;
  v_restored int := 0;
  v_entry jsonb;
  v_before jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can undo an import';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found';
  END IF;
  IF v_batch.status = 'undone' THEN
    RAISE EXCEPTION 'This import was already undone';
  END IF;

  -- Tasks must not have started work yet to be safely removable.
  SELECT count(*) INTO v_deleted
  FROM public.tasks
  WHERE import_batch_id = p_batch_id
    AND status = 'unassigned'
    AND active_started_at IS NULL;

  DELETE FROM public.tasks
  WHERE import_batch_id = p_batch_id
    AND status = 'unassigned'
    AND active_started_at IS NULL;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(COALESCE(v_batch.decision_summary->'refreshed', '[]'::jsonb))
  LOOP
    v_before := v_entry->'before';
    UPDATE public.tasks SET
      customer_name = COALESCE(v_before->>'customer_name', customer_name),
      customer_phone = NULLIF(v_before->>'customer_phone', ''),
      xaafada = NULLIF(v_before->>'xaafada', ''),
      cablebox_code_raw = NULLIF(v_before->>'cablebox_code_raw', ''),
      cablebox_id = NULLIF(v_before->>'cablebox_id', '')::uuid,
      port_number = NULLIF(v_before->>'port_number', '')::int,
      is_urgent = COALESCE((v_before->>'is_urgent')::boolean, is_urgent),
      priority = COALESCE(v_before->>'priority', priority),
      last_seen_on_sheet_date = NULLIF(v_before->>'last_seen_on_sheet_date', '')::date,
      updated_at = now()
    WHERE id = NULLIF(v_entry->>'task_id', '')::uuid;
    v_restored := v_restored + 1;
  END LOOP;

  UPDATE public.import_batches
  SET status = 'undone', undone_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('deleted', v_deleted, 'restored', v_restored);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Read helpers used by the wizard (existing-task lookup)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_existing_tasks(p_token uuid, p_group_id uuid, p_line_numbers text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_result jsonb;
BEGIN
  v_caller := public.get_session_user(p_token);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.tasks t
  WHERE t.group_id = p_group_id
    AND t.line_number = ANY(p_line_numbers);

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Storage bucket for the source pictures (audit trail)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('sheet-images', 'sheet-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  CREATE POLICY "sheet images read" ON storage.objects
    FOR SELECT USING (bucket_id = 'sheet-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "sheet images upload" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'sheet-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
