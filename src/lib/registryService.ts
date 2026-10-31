/**
 * Supabase calls for the cablebox registry.
 *
 * Every call goes through the SECURITY DEFINER RPCs from migration 006, which
 * check the caller's group and (for writes) stamp who changed what.
 */

import { rpc, rpcRead } from './rpc';
import type {
  AnalyticsResponse,
  BoxDetail,
  DirectoryResponse,
  PortResult,
  PortStatus,
} from './registry';

export async function fetchDirectory(token: string, groupId: string): Promise<DirectoryResponse> {
  const payload = await rpcRead<DirectoryResponse>('box_directory', {
    p_token: token,
    p_group_id: groupId,
  });
  return { ...payload, boxes: payload.boxes ?? [] };
}

export async function fetchBoxDetail(token: string, boxId: string): Promise<BoxDetail> {
  const payload = await rpcRead<BoxDetail>('box_detail', {
    p_token: token,
    p_box_id: boxId,
  });
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
  return rpc<PortResult>('set_port_status', {
    p_token: params.token,
    p_box_id: params.boxId,
    p_port_number: params.portNumber,
    p_status: params.status,
    p_notes: params.notes ?? null,
  });
}

export async function fetchAnalytics(
  token: string,
  groupId: string,
  days = 30,
): Promise<AnalyticsResponse> {
  const payload = await rpcRead<AnalyticsResponse>('ops_analytics', {
    p_token: token,
    p_group_id: groupId,
    p_days: days,
  });
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
  const payload = await rpcRead<{ jobs?: ReportJob[] }>('report_jobs', {
    p_token: token,
    p_group_id: groupId,
    p_days: days,
  });
  return (payload?.jobs ?? []) as ReportJob[];
}

export async function seedDemoData(
  token: string,
  groupId: string,
): Promise<{ tasks_created: number; logs_created: number }> {
  return rpc<{ tasks_created: number; logs_created: number }>('seed_demo_data', {
    p_token: token,
    p_group_id: groupId,
  });
}

export async function clearDemoData(
  token: string,
): Promise<{ removed_tasks: number; removed_logs: number; removed_ports: number }> {
  return rpc<{ removed_tasks: number; removed_logs: number; removed_ports: number }>('clear_demo_data', {
    p_token: token,
  });
}
