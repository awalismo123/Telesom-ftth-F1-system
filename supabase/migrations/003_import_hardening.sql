-- ============================================================================
-- Migration 003 — bullet-proof import
--   * safe_date / safe_int helpers so a badly formatted cell can never abort a
--     daily import ("date/time field value out of range: 28-10-2026")
--   * commit_import_batch now takes the print date as TEXT and parses it
--   * one broken row is skipped and reported instead of failing the batch
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tolerant parsers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v text := btrim(COALESCE(p_value, ''));
  v_iso date;
  v_parts text[];
  a int;
  b int;
  c int;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;

  -- Already ISO (2026-10-28)
  IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      RETURN v::date;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  -- ISO with a time part
  BEGIN
    v_iso := v::timestamp::date;
    RETURN v_iso;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- dd-mm-yyyy / dd/mm/yyyy / mm/dd/yyyy / dd.mm.yy …
  v := regexp_replace(v, '[^0-9]+', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');
  v_parts := string_to_array(v, '-');
  IF array_length(v_parts, 1) < 3 THEN
    RETURN NULL;
  END IF;

  a := NULLIF(v_parts[1], '')::int;
  b := NULLIF(v_parts[2], '')::int;
  c := NULLIF(v_parts[3], '')::int;
  IF a IS NULL OR b IS NULL OR c IS NULL THEN
    RETURN NULL;
  END IF;

  -- Year first
  IF a > 31 THEN
    IF a < 100 THEN a := 2000 + a; END IF;
    BEGIN
      RETURN make_date(a, b, c);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  IF c < 100 THEN c := 2000 + c; END IF;

  -- Day first (the format used on the Galinta sheet)
  BEGIN
    RETURN make_date(c, b, a);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- Month first (the format used on the Cilada sheet)
  BEGIN
    RETURN make_date(c, a, b);
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_int(p_value text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v::numeric::int;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  v := regexp_replace(v, '[^0-9]', '', 'g');
  IF v = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v::int;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. commit_import_batch — text print date + per-row fault isolation
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.commit_import_batch(uuid, uuid, text, text, text, date, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.commit_import_batch(
  p_token uuid,
  p_group_id uuid,
  p_sheet_category text,
  p_source_type text,
  p_file_name text,
  p_print_date text,
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
  v_failed int := 0;
  v_box_id uuid;
  v_new_task_id uuid;
  v_refreshed_log jsonb := '[]'::jsonb;
  v_failed_rows jsonb := '[]'::jsonb;
  v_created_ids uuid[] := '{}';
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can import daily sheets';
  END IF;

  INSERT INTO public.import_batches (
    group_id, imported_by, sheet_category, source_type, file_name, print_date,
    total_rows_read, group_matched_rows, new_tasks_created, duplicates_skipped,
    carryovers_updated, source_image_path, decision_summary
  ) VALUES (
    p_group_id, v_caller.id, p_sheet_category, p_source_type, p_file_name,
    public.safe_date(p_print_date),
    COALESCE((p_summary->>'total_rows_read')::int, 0),
    COALESCE((p_summary->>'group_matched_rows')::int, 0),
    0, 0, 0, p_source_image_path, p_summary
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    -- Each row is isolated: a single malformed cell skips that row only.
    BEGIN
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
          public.safe_int(v_task->>'sheet_row_id'),
          p_sheet_category,
          COALESCE(v_task->>'line_number', ''),
          COALESCE(NULLIF(v_task->>'customer_name', ''), 'Unknown'),
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
          public.safe_int(v_task->>'port_number'),
          public.safe_date(v_task->>'reported_date'),
          NULLIF(v_task->>'reported_time', ''),
          COALESCE(NULLIF(v_task->>'priority', ''), 'normal'),
          COALESCE((v_task->>'is_urgent')::boolean, false),
          NULLIF(v_task->>'complain_type', ''),
          COALESCE((v_task->>'is_repeat_fault')::boolean, false),
          NULLIF(v_task->>'previous_task_id', '')::uuid,
          'unassigned',
          COALESCE(public.safe_date(v_task->>'scheduled_date'), CURRENT_DATE),
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

        IF v_before IS NULL THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        UPDATE public.tasks SET
          customer_name = COALESCE(NULLIF(v_task->>'customer_name', ''), customer_name),
          customer_phone = COALESCE(NULLIF(v_task->>'customer_phone', ''), customer_phone),
          x_number = COALESCE(NULLIF(v_task->>'x_number', ''), x_number),
          router_state = COALESCE(NULLIF(v_task->>'router_state', ''), router_state),
          xaafada = COALESCE(NULLIF(v_task->>'xaafada', ''), xaafada),
          cablebox_code_raw = COALESCE(NULLIF(v_task->>'cablebox_code', ''), cablebox_code_raw),
          cablebox_id = COALESCE(v_box_id, cablebox_id),
          port_number = COALESCE(public.safe_int(v_task->>'port_number'), port_number),
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

    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
      v_failed_rows := v_failed_rows || jsonb_build_array(
        jsonb_build_object(
          'line', COALESCE(v_task->>'line_number', ''),
          'name', COALESCE(v_task->>'customer_name', ''),
          'error', SQLERRM
        )
      );
    END;
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
      'skipped', v_skipped,
      'failed', v_failed,
      'failed_rows', v_failed_rows
    )
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'created', v_created,
    'refreshed', v_refreshed,
    'reopened', v_reopened,
    'skipped', v_skipped,
    'failed', v_failed,
    'failed_rows', v_failed_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_import_batch(uuid, uuid, text, text, text, text, text, jsonb, jsonb) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Re-point the other helpers at the tolerant parsers where useful
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
