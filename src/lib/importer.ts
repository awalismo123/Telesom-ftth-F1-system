/**
 * Import diff engine.
 *
 * The wizard never guesses: every row that already exists in the database is
 * surfaced with an explicit conflict type and a default decision the supervisor
 * can override before anything is written.
 */

import { supabase } from './supabase';
import type { Task } from '../types/database';
import type { ExtractedRow } from './ocr/extract';
import { normalizeDate } from './ocr/normalize';

export type ConflictKind =
  | 'new' // brand new line for this group
  | 'carryover' // still open from an earlier day
  | 'repeat' // previously completed → this is a fresh fault
  | 'duplicate_today' // already imported today
  | 'invalid'; // missing line number, unreadable

export type RowDecision = 'create' | 'refresh' | 'reopen' | 'skip';

export interface PlanRow {
  /** mirrors row.id so React keys and handlers stay simple */
  id: string;
  row: ExtractedRow;
  conflict: ConflictKind;
  existing: Task | null;
  decision: RowDecision;
  /** false → ignored (other group / invalid / supervisor unticked) */
  included: boolean;
}

export interface ImportPlan {
  rows: PlanRow[];
  counts: {
    total: number;
    f1: number;
    otherGroups: number;
    invalid: number;
    newRows: number;
    carryovers: number;
    repeats: number;
    duplicates: number;
  };
}

/**
 * Guarantee an ISO `YYYY-MM-DD` string (or '') before anything reaches Postgres.
 * Telesom sheets print dates as `28-10-2026` or `10/26/2026`, and a raw value
 * passed to a `date` column makes the whole import fail with
 * "date/time field value out of range".
 */
export function isoDate(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  const strict = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (strict) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return trimmed;
  }
  return normalizeDate(trimmed) ?? '';
}

function dayKey(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Build the plan: filter to the active group and classify each surviving row.
 */
export async function buildImportPlan(params: {
  token: string;
  groupId: string;
  groupCode: string;
  taskType: 'installation' | 'cilada';
  rows: ExtractedRow[];
}): Promise<ImportPlan> {
  const { token, groupId, groupCode, taskType, rows } = params;
  const today = new Date().toISOString().slice(0, 10);

  const lineNumbers = rows
    .map((r) => r.derived.lineNumber)
    .filter((v): v is string => Boolean(v));

  let existing: Task[] = [];

  if (lineNumbers.length) {
    const unique = [...new Set(lineNumbers)];
    for (let i = 0; i < unique.length; i += 150) {
      const chunk = unique.slice(i, i + 150);
      const { data, error } = await supabase.rpc('find_existing_tasks', {
        p_token: token,
        p_group_id: groupId,
        p_line_numbers: chunk,
      });
      if (!error && Array.isArray(data)) {
        existing = existing.concat(data as Task[]);
      }
    }
  }

  const byLine = new Map<string, Task[]>();
  for (const task of existing) {
    const list = byLine.get(task.line_number) ?? [];
    list.push(task);
    byLine.set(task.line_number, list);
  }

  let otherGroups = 0;
  let invalid = 0;
  let newRows = 0;
  let carryovers = 0;
  let repeats = 0;
  let duplicates = 0;
  let f1 = 0;

  const planRows: PlanRow[] = rows.map((row) => {
    const { lineNumber, groupCode: rowGroup } = row.derived;

    // Group filter — only Group F1 (or the supervisor's active group).
    if (rowGroup && rowGroup !== groupCode) {
      otherGroups++;
      return {
        id: row.id,
        row,
        conflict: 'invalid',
        existing: null,
        decision: 'skip',
        included: false,
      };
    }

    if (!lineNumber) {
      invalid++;
      return {
        id: row.id,
        row,
        conflict: 'invalid',
        existing: null,
        decision: 'skip',
        included: false,
      };
    }

    f1++;

    const candidates = (byLine.get(lineNumber) ?? []).filter((t) => t.task_type === taskType);
    // A cancelled job is finished: the line appearing on today's sheet must be
    // able to import as a fresh job, not be swallowed as "already open".
    const open = candidates.find((t) => t.status !== 'completed' && t.status !== 'cancelled') ?? null;
    const completed = candidates
      .filter((t) => t.status === 'completed')
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0];

    if (open) {
      const importedToday = dayKey(open.created_at) === today;
      if (importedToday) {
        duplicates++;
        return {
          id: row.id,
          row,
          conflict: 'duplicate_today',
          existing: open,
          decision: 'skip',
          included: true,
        };
      }
      carryovers++;
      return {
        id: row.id,
        row,
        conflict: 'carryover',
        existing: open,
        decision: 'refresh',
        included: true,
      };
    }

    if (completed) {
      repeats++;
      return {
        id: row.id,
        row,
        conflict: 'repeat',
        existing: completed,
        decision: 'create',
        included: true,
      };
    }

    newRows++;
    return {
      id: row.id,
      row,
      conflict: 'new',
      existing: null,
      decision: 'create',
      included: true,
    };
  });

  return {
    rows: planRows,
    counts: {
      total: rows.length,
      f1,
      otherGroups,
      invalid,
      newRows,
      carryovers,
      repeats,
      duplicates,
    },
  };
}

export interface TaskPayload {
  sheet_row_id: string;
  line_number: string;
  customer_name: string;
  customer_phone: string;
  x_number: string;
  router_state: string;
  disc_code: string;
  service_type: string;
  work_subtype: string;
  speed_plan: string;
  xaafada: string;
  cablebox_code: string;
  olt_path: string;
  port_number: string;
  reported_date: string;
  reported_time: string;
  complain_type: string;
  priority: string;
  is_urgent: boolean;
  is_repeat_fault: boolean;
  previous_task_id: string;
  scheduled_date: string;
}

export function toTaskPayload(plan: PlanRow, taskType: 'installation' | 'cilada'): TaskPayload {
  const v = plan.row.values;
  const d = plan.row.derived;
  const str = (key: string) => (v[key] === null || v[key] === undefined ? '' : String(v[key]));

  return {
    sheet_row_id: str('sheet_row_id'),
    line_number: d.lineNumber ?? '',
    customer_name: d.customerName,
    customer_phone: d.phone ?? '',
    x_number: str('x_number'),
    router_state: d.routerState === 'unknown' ? '' : d.routerState,
    disc_code: str('disc_code'),
    service_type: str('service_type') || 'Fiber',
    work_subtype: str('work_subtype'),
    speed_plan: str('speed_plan'),
    xaafada: d.xaafada ?? '',
    cablebox_code: d.cableboxCode ?? '',
    olt_path: d.oltPath ?? '',
    port_number: d.cableboxPort !== null ? String(d.cableboxPort) : '',
    reported_date: isoDate(d.reportedDate ?? str('reported_date')),
    reported_time: str('reported_time'),
    complain_type: str('complain_type'),
    priority: d.urgent ? 'urgent' : 'normal',
    is_urgent: d.urgent,
    is_repeat_fault: plan.conflict === 'repeat',
    previous_task_id: plan.conflict === 'repeat' ? (plan.existing?.id ?? '') : '',
    scheduled_date: new Date().toISOString().slice(0, 10), // always ISO
  };
}

/** Upload the source picture so every import can be audited later. */
export async function uploadSourceImage(
  file: Blob,
  groupId: string,
): Promise<string | null> {
  try {
    const extension = file.type.includes('png') ? 'png' : 'jpg';
    const path = `${groupId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('sheet-images').upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

export interface CommitResult {
  batch_id: string;
  created: number;
  refreshed: number;
  reopened: number;
  skipped: number;
}

export async function commitImport(params: {
  token: string;
  groupId: string;
  sheetCategory: 'installation' | 'cilada';
  sourceType: 'image' | 'excel' | 'paste' | 'pdf';
  fileName: string;
  printDate: string | null;
  sourceImagePath: string | null;
  plan: ImportPlan;
}): Promise<CommitResult> {
  const { token, groupId, sheetCategory, sourceType, fileName, printDate, sourceImagePath, plan } =
    params;

  // Never let a raw sheet date reach a Postgres `date` parameter.
  const safePrintDate = isoDate(printDate) || null;

  const rows = plan.rows
    .filter((r) => r.included && r.decision !== 'skip' && r.conflict !== 'invalid')
    .map((r) => ({
      action: r.decision,
      existing_task_id: r.existing?.id ?? '',
      task: toTaskPayload(r, sheetCategory),
    }));

  const summary = {
    total_rows_read: plan.counts.total,
    group_matched_rows: plan.counts.f1,
    other_groups: plan.counts.otherGroups,
    invalid_rows: plan.counts.invalid,
    new_rows: plan.counts.newRows,
    carryovers: plan.counts.carryovers,
    repeats: plan.counts.repeats,
    duplicates: plan.counts.duplicates,
    decisions: {
      create: plan.rows.filter((r) => r.included && r.decision === 'create').length,
      refresh: plan.rows.filter((r) => r.included && r.decision === 'refresh').length,
      reopen: plan.rows.filter((r) => r.included && r.decision === 'reopen').length,
      skip: plan.rows.filter((r) => !r.included || r.decision === 'skip').length,
    },
  };

  const { data, error } = await supabase.rpc('commit_import_batch', {
    p_token: token,
    p_group_id: groupId,
    p_sheet_category: sheetCategory,
    p_source_type: sourceType,
    p_file_name: fileName,
    p_print_date: safePrintDate,
    p_source_image_path: sourceImagePath,
    p_summary: summary,
    p_rows: rows,
  });

  if (error) throw new Error(error.message);
  return data as CommitResult;
}

export async function undoImport(token: string, batchId: string): Promise<{ deleted: number; restored: number }> {
  const { data, error } = await supabase.rpc('undo_import_batch', {
    p_token: token,
    p_batch_id: batchId,
  });
  if (error) throw new Error(error.message);
  return data as { deleted: number; restored: number };
}
