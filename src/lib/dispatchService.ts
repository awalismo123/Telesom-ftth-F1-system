/**
 * Supabase calls for the dispatch board. Everything that changes state goes
 * through the SECURITY DEFINER RPCs from migration 004 — never a direct table
 * write — so the "supervisor only / same group / never touch started work"
 * rules are enforced in one place (the database).
 */

import { supabase } from './supabase';
import type { Task } from '../types/database';
import type { DispatchTarget } from './dispatch';

export interface LoadUser {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
  open_jobs: number;
  active_jobs: number;
  done_today: number;
  urgent_jobs: number;
}

export interface LoadCrew {
  id: string;
  name: string;
  vehicle_tag: string | null;
  zone_focus: string | null;
  members: { id: string; full_name: string }[];
  open_jobs: number;
  active_jobs: number;
  done_today: number;
  urgent_jobs: number;
}

export interface DispatchLoad {
  users: LoadUser[];
  crews: LoadCrew[];
}

export interface AssignResult {
  assigned: number;
  skipped: number;
  skipped_detail: { id: string; reason: string }[];
  target: string;
}

/**
 * Every job that still needs attention. Finished jobs are not needed here —
 * the "done today" numbers come from the `dispatch_load` RPC — which keeps the
 * board fast and avoids a date filter that PostgreSQL would have to parse.
 */
export async function fetchDispatchTasks(groupId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('group_id', groupId)
    .neq('status', 'completed')
    .order('reported_date', { ascending: true })
    .limit(600);

  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}

export async function fetchDispatchLoad(token: string, groupId: string): Promise<DispatchLoad> {
  const { data, error } = await supabase.rpc('dispatch_load', {
    p_token: token,
    p_group_id: groupId,
  });
  if (error) throw new Error(error.message);
  return (data ?? { users: [], crews: [] }) as DispatchLoad;
}

/** Crews first (they are the normal unit), then individual technicians. */
export function toTargets(load: DispatchLoad): DispatchTarget[] {
  const crews: DispatchTarget[] = load.crews.map((crew) => ({
    kind: 'crew',
    id: crew.id,
    name: crew.name,
    subtitle: [crew.vehicle_tag, crew.members.map((m) => m.full_name.split(' ')[0]).join(' + ')]
      .filter(Boolean)
      .join(' · '),
    zoneFocus: crew.zone_focus,
    openJobs: Number(crew.open_jobs) || 0,
    urgentJobs: Number(crew.urgent_jobs) || 0,
    activeJobs: Number(crew.active_jobs) || 0,
    doneToday: Number(crew.done_today) || 0,
  }));

  const users: DispatchTarget[] = load.users.map((user) => ({
    kind: 'user',
    id: user.id,
    name: user.full_name,
    subtitle: `@${user.username}`,
    zoneFocus: null,
    openJobs: Number(user.open_jobs) || 0,
    urgentJobs: Number(user.urgent_jobs) || 0,
    activeJobs: Number(user.active_jobs) || 0,
    doneToday: Number(user.done_today) || 0,
  }));

  return [...crews, ...users];
}

export async function assignTasks(params: {
  token: string;
  groupId: string;
  taskIds: string[];
  target: DispatchTarget;
}): Promise<AssignResult> {
  const { token, groupId, taskIds, target } = params;

  const { data, error } = await supabase.rpc('assign_tasks', {
    p_token: token,
    p_group_id: groupId,
    p_task_ids: taskIds,
    p_user_id: target.kind === 'user' ? target.id : null,
    p_crew_id: target.kind === 'crew' ? target.id : null,
  });

  if (error) throw new Error(error.message);
  return data as AssignResult;
}

export async function unassignTasks(params: {
  token: string;
  groupId: string;
  taskIds: string[];
}): Promise<{ released: number; skipped: number }> {
  const { data, error } = await supabase.rpc('unassign_tasks', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_task_ids: params.taskIds,
  });
  if (error) throw new Error(error.message);
  return data as { released: number; skipped: number };
}

export async function logDispatch(params: {
  token: string;
  groupId: string;
  channel: 'clipboard' | 'share' | 'whatsapp' | 'telegram';
  message: string;
  taskIds: string[];
  crewCount: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('log_dispatch', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_channel: params.channel,
    p_message: params.message,
    p_task_ids: params.taskIds,
    p_crew_count: params.crewCount,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
