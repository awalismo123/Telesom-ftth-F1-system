/**
 * Supabase calls for the technician app.
 *
 * Every write goes through the SECURITY DEFINER RPCs from migration 005, which
 * check that the caller really works the job and stamp the server clock.
 * All calls go through `rpc()` so failures arrive as readable sentences.
 */

import { supabase } from './supabase';
import { rpc, rpcRead } from './rpc';
import { toAppError } from './errors';
import type { BlockerReason, Task } from '../types/database';
import type { RouteResponse, RouteTask } from './execution';

export interface StartResult {
  task_id: string;
  status: string;
  already_running?: boolean;
  needs_confirmation?: boolean;
  other_running?: { id: string; line_number: string; customer_name: string }[];
  active_started_at?: string | null;
  accumulated_seconds?: number;
  server_now: string;
}

export interface BlockResult {
  task_id: string;
  status: 'blocked';
  session_seconds: number;
  accumulated_seconds: number;
  reason: BlockerReason;
  server_now: string;
}

export interface CompleteResult {
  task_id: string;
  status: 'completed';
  duration_seconds: number;
  session_seconds: number;
  optical_dbm: number;
  completed_at: string;
  server_now: string;
}

export async function fetchRoute(token: string): Promise<RouteResponse> {
  const payload = await rpcRead<RouteResponse>('technician_route', { p_token: token });
  return { ...payload, tasks: (payload.tasks ?? []) as RouteTask[] };
}

/**
 * `confirm` = false performs a dry run that only reports the jobs already
 * running, so the app can warn before the technician has two clocks going.
 */
export async function startTask(token: string, taskId: string, confirm = true): Promise<StartResult> {
  return rpc<StartResult>('start_task', {
    p_token: token,
    p_task_id: taskId,
    p_force: confirm,
  });
}

export async function blockTask(params: {
  token: string;
  taskId: string;
  reason: BlockerReason;
  notes?: string;
}): Promise<BlockResult> {
  return rpc<BlockResult>('block_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_reason: params.reason,
    p_notes: params.notes ?? null,
  });
}

export async function resumeTask(token: string, taskId: string): Promise<StartResult> {
  return rpc<StartResult>('resume_task', {
    p_token: token,
    p_task_id: taskId,
  });
}

export async function completeTask(params: {
  token: string;
  taskId: string;
  dbm: number;
  notes?: string;
  portNumber?: number | null;
}): Promise<CompleteResult> {
  return rpc<CompleteResult>('complete_task', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_dbm: params.dbm,
    p_notes: params.notes ?? null,
    p_port_number: params.portNumber ?? null,
  });
}

export interface WorkLogRow {
  id: string;
  action: string;
  session_seconds: number;
  blocker_reason: BlockerReason | null;
  optical_dbm: number | string | null;
  notes: string | null;
  created_at: string;
}

/** The history of one job: who did what, when, and how long it took. */
export async function fetchWorkLog(taskId: string): Promise<WorkLogRow[]> {
  const { data, error } = await supabase
    .from('task_work_logs')
    .select('id, action, session_seconds, blocker_reason, optical_dbm, notes, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw new Error(toAppError(error).message);
  return (data ?? []) as WorkLogRow[];
}

/* -------------------------------------------------------------------------- */
/* Supervisor: who is on a job right now                                      */
/* -------------------------------------------------------------------------- */

export interface LiveRow {
  id: string;
  line_number: string;
  customer_name: string;
  cablebox_code_raw: string | null;
  xaafada: string | null;
  status: 'in_progress' | 'blocked' | Task['status'];
  started_at: string | null;
  accumulated_seconds: number;
  blocker_reason: BlockerReason | null;
  priority: 'normal' | 'urgent';
  worker_name: string;
  worker_kind: 'crew' | 'user';
}

export async function fetchLiveStatus(params: {
  token: string;
  groupId: string;
}): Promise<{ rows: LiveRow[]; server_now: string }> {
  return rpcRead<{ rows: LiveRow[]; server_now: string }>('live_status', {
    p_token: params.token,
    p_group_id: params.groupId,
  });
}
