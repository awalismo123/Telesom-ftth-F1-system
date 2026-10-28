/**
 * Supabase calls for the cablebox registry.
 *
 * Every call goes through the SECURITY DEFINER RPCs from migration 006, which
 * check the caller's group and (for writes) stamp who changed what.
 */

import { supabase } from './supabase';
import type {
  AnalyticsResponse,
  BoxDetail,
  DirectoryResponse,
  PortResult,
  PortStatus,
} from './registry';

export async function fetchDirectory(token: string, groupId: string): Promise<DirectoryResponse> {
  const { data, error } = await supabase.rpc('box_directory', {
    p_token: token,
    p_group_id: groupId,
  });
  if (error) throw new Error(error.message);
  const payload = data as DirectoryResponse;
  return { ...payload, boxes: payload.boxes ?? [] };
}

export async function fetchBoxDetail(token: string, boxId: string): Promise<BoxDetail> {
  const { data, error } = await supabase.rpc('box_detail', {
    p_token: token,
    p_box_id: boxId,
  });
  if (error) throw new Error(error.message);
  const payload = data as BoxDetail;
  return {
    ...payload,
    ports: payload.ports ?? [],
    incidents: payload.incidents ?? [],
    jobs: payload.jobs ?? [],
  };
}

export async function setPortStatus(params: {
  token: string;
  boxId: string;
  portNumber: number;
  status: PortStatus;
  notes?: string;
}): Promise<PortResult> {
  const { data, error } = await supabase.rpc('set_port_status', {
    p_token: params.token,
    p_box_id: params.boxId,
    p_port_number: params.portNumber,
    p_status: params.status,
    p_notes: params.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PortResult;
}

export async function fetchAnalytics(
  token: string,
  groupId: string,
  days = 30,
): Promise<AnalyticsResponse> {
  const { data, error } = await supabase.rpc('ops_analytics', {
    p_token: token,
    p_group_id: groupId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  const payload = data as AnalyticsResponse;
  return {
    ...payload,
    daily: payload.daily ?? [],
    techs: payload.techs ?? [],
    boxes: payload.boxes ?? [],
    blockers: payload.blockers ?? [],
  };
}

export interface ReportJob {
  id: string;
  line_number: string;
  customer_name: string;
  completed_at: string | null;
  duration_seconds: number;
  optical_dbm: number | null;
  port_number: number | null;
  cablebox: string | null;
  worker: string | null;
  task_type: string;
  priority: string;
  is_demo: boolean;
}

export async function fetchReportJobs(
  token: string,
  groupId: string,
  days = 30,
): Promise<ReportJob[]> {
  const { data, error } = await supabase.rpc('report_jobs', {
    p_token: token,
    p_group_id: groupId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return ((data as { jobs?: ReportJob[] })?.jobs ?? []) as ReportJob[];
}

export async function seedDemoData(
  token: string,
  groupId: string,
): Promise<{ tasks_created: number; logs_created: number }> {
  const { data, error } = await supabase.rpc('seed_demo_data', {
    p_token: token,
    p_group_id: groupId,
  });
  if (error) throw new Error(error.message);
  return data as { tasks_created: number; logs_created: number };
}

export async function clearDemoData(
  token: string,
): Promise<{ removed_tasks: number; removed_logs: number; removed_ports: number }> {
  const { data, error } = await supabase.rpc('clear_demo_data', { p_token: token });
  if (error) throw new Error(error.message);
  return data as { removed_tasks: number; removed_logs: number; removed_ports: number };
}
