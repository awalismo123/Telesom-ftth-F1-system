/**
 * Supabase calls for Batch E.
 *
 * Every write goes through a SECURITY DEFINER RPC — box registration, phone-in
 * jobs, cancel, reopen — so "supervisor only", "same group" and "a cancelled job
 * cannot move" are enforced by the database rather than by a disabled button.
 */

import { supabase } from './supabase';
import { rpc, rpcRead } from './rpc';
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
export async function fetchTask(taskId: string): Promise<Task> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();
  if (error) throw new Error(error.message);
  return data as Task;
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

  const { data, error } = await supabase
    .from('task_work_logs')
    .select('task_id, created_at, notes')
    .in('task_id', ids)
    .eq('action', 'resumed')
    .gte('created_at', new Date(params.seenAt).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);

  return { tasks, resumed: (data ?? []) as ResumedLog[] };
}

/** Blocked or long-running work in the group, for the supervisor's bell. */
export async function fetchSupervisorNotifications(groupId: string): Promise<NotificationTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, line_number, customer_name, status, blocked_at, active_started_at, blocker_reason',
    )
    .eq('group_id', groupId)
    .in('status', ['blocked', 'in_progress'])
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationTask[];
}

export type { SearchResponse, NotificationTask, ResumedLog };
