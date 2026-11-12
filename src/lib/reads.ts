import { rpcRead, rpc } from './rpc';
import type { Cablebox, Crew, Task, UserProfile } from '../types/database';
import type { ActivityEvent } from './activity';

/**
 * Every read the app performs, in one place, through a token-checked function.
 *
 * Before Batch B the client talked to tables directly (`supabase.from('tasks')
 * .select('*')`), which meant every table had to be readable by the anonymous
 * role — and the anonymous key is published inside the bundle. Anyone who found
 * the URL could read every customer name, phone number and address while signed
 * out.
 *
 * Now the tables are closed. Each function below calls a `SECURITY DEFINER` RPC
 * that takes the session token, resolves the caller, and returns only rows from
 * the caller's own group. The anon key remains public — it is an identifier, not
 * a secret — and it grants exactly what these functions allow.
 *
 * This is also the reason there is no `.from(` left in `src/`: a test enforces
 * that, so a future shortcut cannot quietly reopen the hole.
 */

export interface CrewLink {
  crew_id: string;
  user_id: string;
}

export interface GroupCounts {
  technicians: number;
  crews: number;
  open_tasks: number;
  unassigned: number;
}

export interface GroupOverview {
  members: UserProfile[];
  crews: Crew[];
  crew_members: CrewLink[];
  cableboxes: Cablebox[];
  counts: GroupCounts;
}

/** The caller's own group. `groups` is no longer world-readable. */
export async function fetchGroups(token: string) {
  const data = await rpcRead<{ id: string; code: string; name: string; description: string | null }[] | null>(
    'list_groups',
    { p_token: token },
  );
  return data ?? [];
}

/**
 * The supervisor's shell in one round trip: people, crews, crew links, boxes,
 * and the three counts. Six queries became one, and each piece is scoped to the
 * group by the database rather than by a filter the browser could omit.
 */
export async function fetchGroupOverview(token: string, groupId: string): Promise<GroupOverview> {
  const raw =
    (await rpcRead<GroupOverview | null>('group_overview', {
      p_token: token,
      p_group_id: groupId,
    })) ?? ({} as GroupOverview);

  return {
    members: (raw.members ?? []) as UserProfile[],
    crews: (raw.crews ?? []) as Crew[],
    crew_members: (raw.crew_members ?? []) as CrewLink[],
    cableboxes: (raw.cableboxes ?? []) as Cablebox[],
    counts: raw.counts ?? { technicians: 0, crews: 0, open_tasks: 0, unassigned: 0 },
  };
}

/** Open work for the dispatch board. */
export async function fetchOpenTasks(token: string, groupId: string): Promise<Task[]> {
  const data = await rpcRead<Task[] | null>('list_open_tasks', {
    p_token: token,
    p_group_id: groupId,
  });
  return data ?? [];
}

/** One job, for a sheet that acts on it. */
export async function fetchTask(token: string, taskId: string): Promise<Task> {
  return (await rpcRead<Task>('get_task', { p_token: token, p_task_id: taskId })) as Task;
}

export interface WorkLogRow {
  id: string;
  action: string;
  session_seconds: number | null;
  blocker_reason: string | null;
  optical_dbm: number | null;
  notes: string | null;
  created_at: string;
}

export async function fetchWorkLogs(token: string, taskId: string): Promise<WorkLogRow[]> {
  const data = await rpcRead<WorkLogRow[] | null>('list_work_logs', {
    p_token: token,
    p_task_id: taskId,
  });
  return data ?? [];
}

export interface LiveMoveTask {
  id: string;
  line_number: string;
  customer_name: string;
  status: string;
  blocked_at: string | null;
  active_started_at: string | null;
  blocker_reason: string | null;
}

/** Blocked and in-progress jobs — what the notification bell counts. */
export async function fetchLiveMoves(token: string, groupId: string): Promise<LiveMoveTask[]> {
  const data = await rpcRead<LiveMoveTask[] | null>('list_live_moves', {
    p_token: token,
    p_group_id: groupId,
  });
  return data ?? [];
}

export interface ResumedLog {
  task_id: string;
  created_at: string;
  notes: string | null;
}

/** Jobs that started moving again since a moment. */
export async function fetchResumedSince(token: string, sinceIso: string): Promise<ResumedLog[]> {
  const data = await rpcRead<ResumedLog[] | null>('list_resumed_since', {
    p_token: token,
    p_since: sinceIso,
  });
  return data ?? [];
}

export interface ImportBatchRow {
  id: string;
  sheet_category: string;
  source_type: string;
  file_name: string | null;
  print_date: string | null;
  total_rows_read: number;
  group_matched_rows: number;
  new_tasks_created: number;
  duplicates_skipped: number;
  carryovers_updated: number;
  status: string;
  created_at: string;
  source_image_path: string | null;
}

export async function fetchImportBatches(
  token: string,
  groupId: string,
  limit = 8,
): Promise<ImportBatchRow[]> {
  const data = await rpcRead<ImportBatchRow[] | null>('list_import_batches', {
    p_token: token,
    p_group_id: groupId,
    p_limit: limit,
  });
  return data ?? [];
}

export interface MyTeam {
  crew_members: CrewLink[];
  members: UserProfile[];
}

/** A technician's own crew mates. Replaces two table reads in the account sheet. */
export async function fetchMyTeam(token: string): Promise<MyTeam> {
  const raw = (await rpcRead<MyTeam | null>('my_team', { p_token: token })) ?? ({} as MyTeam);
  return {
    crew_members: (raw.crew_members ?? []) as CrewLink[],
    members: (raw.members ?? []) as UserProfile[],
  };
}

/**
 * Store the photograph a batch was read from.
 *
 * It used to go into a public storage bucket, which meant every customer sheet
 * the group had ever posted was fetchable by URL with no authentication. It now
 * goes into a table that only a token-checked function can read back.
 *
 * Returns `null` rather than throwing: the import is the job, the archived photo
 * is the audit trail, and losing the audit trail must not lose the supervisor's
 * work.
 */
export async function uploadSheetImage(
  token: string,
  groupId: string,
  file: Blob,
): Promise<string | null> {
  try {
    const base64 = await blobToBase64(file);
    const data = await rpc<{ id: string } | null>(
      'upload_sheet_image',
      {
        p_token: token,
        p_group_id: groupId,
        p_mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        p_base64: base64,
      },
      { timeoutMs: 60_000, quiet: true },
    );
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/** Read a stored sheet back, for the "where did these rows come from" view. */
export async function fetchSheetImage(token: string, imageId: string) {
  const raw = (await rpcRead<{ mime: string; base64: string; created_at: string }>(
    'get_sheet_image',
    { p_token: token, p_image_id: imageId },
  )) as { mime: string; base64: string; created_at: string };
  return { ...raw, dataUrl: `data:${raw.mime};base64,${raw.base64}` };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/* -------------------------------------------------------------------------- */
/* Batch H — the record                                                       */
/* -------------------------------------------------------------------------- */

export interface PeriodReportTotals {
  created: number;
  completed: number;
  cancelled: number;
  open_at_end: number;
  waiting_over_sla: number;
  avg_minutes: number;
  avg_dbm: number | null;
  repeat_faults: number;
  dispatches: number;
  /** Completion photos attached in the period (Batch H). */
  photos: number;
}

export interface PeriodReport {
  from: string;
  to: string;
  totals: PeriodReportTotals;
  techs: { id: string; name: string; completed: number; avg_minutes: number; avg_dbm: number | null }[];
  boxes: {
    box_code: string;
    health_status: string;
    total_ports: number;
    damaged_ports: number;
    faults: number;
  }[];
  cancel_reasons: { reason: string; count: number }[];
  daily: { day: string; completed: number; created: number }[];
}

/**
 * The audit feed: job changes, dispatch sends, cancellations and phone-in jobs,
 * merged in one call and scoped to the caller's group.
 */
export async function fetchActivity(
  token: string,
  groupId: string,
  days = 7,
  limit = 200,
): Promise<ActivityEvent[]> {
  const data = await rpcRead<ActivityEvent[] | null>('group_activity', {
    p_token: token,
    p_group_id: groupId,
    p_days: days,
    p_limit: limit,
  });
  return data ?? [];
}

/**
 * How many of the rows behind a report are demo.
 *
 * `period_report` and `manager_portfolio` count demo work as real work. This
 * is the label, kept as its own small call rather than an extra key inside two
 * functions that are already 5 kB of SQL each (migration 021 explains why).
 */
import type { DemoSummary } from './demo';
export type { DemoSummary } from './demo';

export async function fetchDemoSummary(
  token: string,
  params: { groupId?: string | null; from?: string | null; to?: string | null } = {},
): Promise<DemoSummary> {
  return (await rpcRead<DemoSummary>('demo_summary', {
    p_token: token,
    p_group_id: params.groupId ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
  })) as DemoSummary;
}

/** One period, as aggregates a manager can print. */
export async function fetchPeriodReport(
  token: string,
  groupId: string,
  from: string,
  to: string,
): Promise<PeriodReport> {
  return (await rpcRead<PeriodReport>('period_report', {
    p_token: token,
    p_group_id: groupId,
    p_from: from,
    p_to: to,
  })) as PeriodReport;
}

/* -------------------------------------------------------------------------- */
/* Photo proof (Batch H)                                                       */
/* -------------------------------------------------------------------------- */

export interface TaskPhotoMeta {
  id: string;
  mime: string;
  byte_size: number;
  created_at: string;
  uploaded_by_name: string;
  uploaded_by_role: string;
}

export interface TaskPhoto extends TaskPhotoMeta {
  task_id: string;
  /** The JPEG itself, base64. Never logged, never cached. */
  base64: string;
}

/** Which photos a completed job has. Thumbnails are fetched one at a time. */
export async function fetchTaskPhotos(token: string, taskId: string): Promise<TaskPhotoMeta[]> {
  const data = await rpcRead<TaskPhotoMeta[] | null>('list_task_photos', {
    p_token: token,
    p_task_id: taskId,
  });
  return data ?? [];
}

/** One photo, bytes included. The group check happens on the server. */
export async function fetchTaskPhoto(token: string, photoId: string): Promise<TaskPhoto> {
  return (await rpcRead<TaskPhoto>('get_task_photo', {
    p_token: token,
    p_photo_id: photoId,
  })) as TaskPhoto;
}

/* -------------------------------------------------------------------------- */
/* Manager — every group, read-only (Batch H)                                  */
/* -------------------------------------------------------------------------- */

export interface ManagerGroupRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  members: number;
  technicians: number;
  unassigned: number;
  active: number;
  blocked: number;
  urgent: number;
  waiting_over_sla: number;
  completed: number;
  photos: number;
  avg_minutes: number;
  last_activity_at: string | null;
}

export interface ManagerPortfolio {
  window_days: number;
  generated_at: string;
  groups: ManagerGroupRow[];
  totals: {
    members: number;
    technicians: number;
    unassigned: number;
    active: number;
    blocked: number;
    urgent: number;
    waiting_over_sla: number;
    completed: number;
    photos: number;
    groups: number;
    live_groups: number;
  };
}

export interface ManagerActivityEvent extends ActivityEvent {
  group_code: string;
  group_id: string;
}

export interface ManagerReport extends PeriodReport {
  scope: 'manager';
  groups: { id: string; code: string; name: string; totals: PeriodReportTotals }[];
}

/** Every group with its load — the manager's first screen. */
export async function fetchManagerPortfolio(token: string, days = 30): Promise<ManagerPortfolio> {
  return (await rpcRead<ManagerPortfolio>('manager_portfolio', {
    p_token: token,
    p_days: days,
  })) as ManagerPortfolio;
}

/** The record across groups, optionally narrowed to one. */
export async function fetchManagerActivity(
  token: string,
  days = 7,
  groupId: string | null = null,
  limit = 300,
): Promise<ManagerActivityEvent[]> {
  const data = await rpcRead<ManagerActivityEvent[] | null>('manager_activity', {
    p_token: token,
    p_days: days,
    p_group_id: groupId,
    p_limit: limit,
  });
  return data ?? [];
}

/** One period across groups, with a row per group. */
export async function fetchManagerReport(
  token: string,
  from: string,
  to: string,
  groupId: string | null = null,
): Promise<ManagerReport> {
  return (await rpcRead<ManagerReport>('manager_report', {
    p_token: token,
    p_from: from,
    p_to: to,
    p_group_id: groupId,
  })) as ManagerReport;
}

/** The open jobs of one group — read-only, no assignment controls. */
export async function fetchManagerTasks(token: string, groupId: string): Promise<Task[]> {
  return (await rpcRead<Task[]>('manager_tasks', {
    p_token: token,
    p_group_id: groupId,
  })) as Task[];
}
