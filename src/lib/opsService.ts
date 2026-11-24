/**
 * Supabase calls for Batch E.
 *
 * Every write goes through a SECURITY DEFINER RPC — box registration, phone-in
 * jobs, cancel, reopen — so "supervisor only", "same group" and "a cancelled job
 * cannot move" are enforced by the database rather than by a disabled button.
 */

import { rpc, rpcRead } from './rpc';
import {
  fetchLiveMoves as readLiveMoves,
  fetchResumedSince as readResumedSince,
  fetchTask as readTask,
} from './reads';
import type { BoxDraft } from './ops';
import type { SearchResponse, NotificationTask, ResumedLog } from './ops';
import type { Task } from '../types/database';

export interface BoxUpsertResult {
  ok: boolean;
  reason: 'created' | 'updated' | 'duplicate';
  box: {
    id: string;
    group_id: string;
    box_code: string;
    xaafada: string | null;
    olt_path: string | null;
    total_ports: number;
    health_status: string;
    location_notes?: string | null;
    ports_used?: number;
    ports_damaged?: number;
  };
}

export async function upsertCablebox(params: {
  token: string;
  groupId: string;
  draft: BoxDraft;
}): Promise<BoxUpsertResult> {
  return rpc<BoxUpsertResult>('upsert_cablebox', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_box_id: params.draft.id,
    p_box_code: params.draft.box_code,
    p_xaafada: params.draft.xaafada,
    p_olt_path: params.draft.olt_path,
    p_total_ports: params.draft.total_ports,
    p_location_notes: params.draft.location_notes,
  });
}

export interface ManualTaskResult {
  ok: boolean;
  reason: 'created' | 'duplicate';
  task: Task | { id: string; line_number: string; customer_name: string; status: string };
  assigned_to?: string | null;
}

export async function createManualTask(params: {
  token: string;
  groupId: string;
  payload: Record<string, unknown>;
  allowDuplicate?: boolean;
}): Promise<ManualTaskResult> {
  return rpc<ManualTaskResult>('create_manual_task', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_payload: params.payload,
    p_allow_duplicate: params.allowDuplicate ?? false,
  });
}

export interface CancelResult {
  ok: boolean;
  task_id: string;
  status: 'cancelled';
  already?: boolean;
  accumulated_seconds?: number;
}

export async function cancelTask(params: {
  token: string;
  taskId: string;
  reason: string;
}): Promise<CancelResult> {
  return rpc<CancelResult>('cancel_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_reason: params.reason,
  });
}

export interface ReopenResult {
  ok: boolean;
  task_id: string;
  status: string;
  previous_status: string;
  reopened_count: number;
}

export async function reopenTask(params: {
  token: string;
  taskId: string;
  reason?: string;
}): Promise<ReopenResult> {
  return rpc<ReopenResult>('reopen_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_reason: params.reason ?? null,
  });
}

export async function globalSearch(params: {
  token: string;
  groupId: string;
  query: string;
}): Promise<SearchResponse> {
  const payload = await rpcRead<SearchResponse>('global_search', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_query: params.query,
  });

  return {
    tasks: payload?.tasks ?? [],
    boxes: payload?.boxes ?? [],
    query: payload?.query ?? params.query,
  };
}

/** A single job, including ones the dispatch board no longer lists. */
export async function fetchTask(token: string, taskId: string): Promise<Task> {
  return readTask(token, taskId);
}

/**
 * What the technician should be told without opening anything.
 *
 * The route RPC already returns exactly the jobs that belong to this person,
 * including when they were assigned — reusing it keeps one definition of "my
 * work" instead of a second, subtly different query.
 */
export async function fetchTechnicianNotifications(params: {
  token: string;
  seenAt: number;
}): Promise<{ tasks: NotificationTask[]; resumed: ResumedLog[] }> {
  const route = await rpcRead<{ tasks?: NotificationTask[] }>('technician_route', {
    p_token: params.token,
  });

  const tasks = route?.tasks ?? [];
  const ids = tasks.map((task) => task.id).filter(Boolean);

  if (ids.length === 0) return { tasks, resumed: [] };

  // Scoped server-side to the caller's group and to work they can see; the id
  // list is only a hint, not the authorisation.
  const resumed = await readResumedSince(params.token, new Date(params.seenAt).toISOString());

  return { tasks, resumed: resumed.filter((row) => ids.includes(row.task_id)) as ResumedLog[] };
}

/** Blocked or long-running work in the group, for the supervisor's bell. */
export async function fetchSupervisorNotifications(
  token: string,
  groupId: string,
): Promise<NotificationTask[]> {
  const rows = await readLiveMoves(token, groupId);
  return rows as unknown as NotificationTask[];
}

export type { SearchResponse, NotificationTask, ResumedLog };

export interface ScheduleResult {
  ok: boolean;
  /** False when the job already had that day — nothing was written. */
  changed: boolean;
  task: Task;
}

/**
 * Move a job to another day.
 *
 * The date is a calendar day string, not a Date: the RPC takes a `date` and the
 * client compares day strings, so no timezone sits between the two.
 */
export async function setTaskSchedule(params: {
  token: string;
  taskId: string;
  day: string;
}): Promise<ScheduleResult> {
  return rpc<ScheduleResult>('set_task_schedule', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_day: params.day,
  });
}

export interface EditTaskParams {
  token: string;
  taskId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  xaafada?: string | null;
  cableboxCodeRaw?: string | null;
  portNumber?: number | null;
  priority?: 'normal' | 'urgent' | null;
  faultType?: string | null;
  reportedDate?: string | null;
  /** Explicitly wipe the fault type. Separate from `faultType` because passing
   *  `null` there means "leave it alone", and clearing is a distinct intent. */
  clearFaultType?: boolean;
}

/**
 * Correct a job.
 *
 * Every parameter is optional and `null` means "leave it alone", so a form can
 * send only what the supervisor actually changed. The database refuses the
 * things a form cannot be trusted with — a completed job, a fault type on an
 * installation, a date in the future — and logs the previous values.
 */
export async function editTask(params: EditTaskParams): Promise<Task> {
  return rpc<Task>('edit_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_customer_name: params.customerName ?? null,
    p_customer_phone: params.customerPhone ?? null,
    p_xaafada: params.xaafada ?? null,
    p_cablebox_code_raw: params.cableboxCodeRaw ?? null,
    p_port_number: params.portNumber ?? null,
    p_priority: params.priority ?? null,
    p_fault_type: params.faultType ?? null,
    p_reported_date: params.reportedDate ?? null,
    p_clear_fault_type: params.clearFaultType ?? false,
  });
}

export interface SetFaultTypeResult {
  task_id: string;
  before: string | null;
  fault_type: string | null;
}

/**
 * Say what kind of fault this is.
 *
 * Separate from `editTask` because it is separate *work*: the person who knows
 * the fault type is often the technician standing at the box, and `edit_task`
 * is supervisor-only. This one accepts either role — a supervisor for any job in
 * the group, a technician for their own — and records the previous value, so
 * "who first said cut cable" is answerable later.
 *
 * `null` clears it, which is the honest correction for a type set by mistake.
 */
export async function setFaultType(params: {
  token: string;
  taskId: string;
  faultType: string | null;
}): Promise<SetFaultTypeResult> {
  return rpc<SetFaultTypeResult>('set_fault_type', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_fault_type: params.faultType,
  });
}

export interface DeleteTaskResult {
  ok: boolean;
  deleted: number;
  line_number: string;
  reason: string;
}

/**
 * Delete a job permanently.
 *
 * The server refuses anything that has been worked on, has logs, photos,
 * materials or a box record — so a refusal here is a policy decision, not a bug,
 * and the message it returns is the one to show.
 */
export async function deleteTask(params: {
  token: string;
  taskId: string;
  reason: string;
}): Promise<DeleteTaskResult> {
  return rpc<DeleteTaskResult>('delete_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_reason: params.reason,
  });
}

/**
 * Delete many, one at a time, collecting what refused.
 *
 * Deliberately sequential rather than parallel: each call takes a row lock, and
 * eleven simultaneous deletes on the same group is a lock queue for no gain.
 * Failures are collected rather than thrown, because "7 deleted, 3 refused" is
 * the truthful outcome of a bulk action and an exception would lose six of them.
 */
export async function deleteTasksBulk(params: {
  token: string;
  taskIds: string[];
  reason: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ deleted: string[]; refused: { taskId: string; message: string }[] }> {
  const deleted: string[] = [];
  const refused: { taskId: string; message: string }[] = [];

  let done = 0;
  for (const taskId of params.taskIds) {
    try {
      await deleteTask({ token: params.token, taskId, reason: params.reason });
      deleted.push(taskId);
    } catch (err) {
      refused.push({
        taskId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    params.onProgress?.(done, params.taskIds.length);
  }

  return { deleted, refused };
}

/** Set the fault type on many faults at once — the fix for "not recorded". */
export async function setFaultTypeBulk(params: {
  token: string;
  taskIds: string[];
  faultType: string;
}): Promise<{ updated: number; refused: { taskId: string; message: string }[] }> {
  let updated = 0;
  const refused: { taskId: string; message: string }[] = [];

  for (const taskId of params.taskIds) {
    try {
      await setFaultType({ token: params.token, taskId, faultType: params.faultType });
      updated += 1;
    } catch (err) {
      refused.push({ taskId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { updated, refused };
}

/** Raise or lower the urgency of many jobs at once. */
export async function setPriorityBulk(params: {
  token: string;
  taskIds: string[];
  priority: 'normal' | 'urgent';
}): Promise<{ updated: number; refused: { taskId: string; message: string }[] }> {
  let updated = 0;
  const refused: { taskId: string; message: string }[] = [];

  for (const taskId of params.taskIds) {
    try {
      await editTask({ token: params.token, taskId, priority: params.priority });
      updated += 1;
    } catch (err) {
      refused.push({ taskId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { updated, refused };
}

/**
 * Give many jobs the same area and/or box.
 *
 * ## Why this exists
 *
 * The 24/11 fault sheet arrived with **13 of its 15 open faults having neither
 * an area nor a box**, and `clusterTasks` groups on exactly those two fields. So
 * two thirds of the backlog could not be planned, and the only way to fix it was
 * one job at a time through the edit sheet — thirteen openings, thirteen saves.
 *
 * Placement is also the one bulk edit that is *safe*: it changes where a job is,
 * never what happened to it. It cannot assign, start a timer, or complete
 * anything, so it runs no risk of skipping a flow that has its own rules.
 *
 * Empty strings mean "leave this field alone", so a supervisor can set just the
 * area across a neighbourhood and leave the box codes to a second pass.
 */
export async function setPlacementBulk(params: {
  token: string;
  taskIds: string[];
  xaafada?: string;
  cableboxCodeRaw?: string;
}): Promise<{ updated: number; refused: { taskId: string; message: string }[] }> {
  const area = params.xaafada?.trim() ?? '';
  const box = params.cableboxCodeRaw?.trim() ?? '';

  // Nothing to do: refuse loudly rather than "succeed" having changed nothing.
  if (!area && !box) {
    throw new Error('Say the area or the box code to apply.');
  }

  let updated = 0;
  const refused: { taskId: string; message: string }[] = [];

  for (const taskId of params.taskIds) {
    try {
      await editTask({
        token: params.token,
        taskId,
        // `null` means "leave alone" in edit_task; an empty string would blank
        // the field, which is the opposite of what a partial bulk edit wants.
        xaafada: area || null,
        cableboxCodeRaw: box || null,
      });
      updated += 1;
    } catch (err) {
      refused.push({ taskId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { updated, refused };
}
