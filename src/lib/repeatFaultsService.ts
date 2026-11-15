import { rpc } from './rpc';
import type { RepeatCount, RepeatWatch } from './repeatFaults';

/** The supervisor's watch list. Supervisors and managers only. */
export async function fetchRepeatFaultWatch(params: {
  token: string;
  groupId: string;
  days?: number;
  threshold?: number;
}): Promise<RepeatWatch> {
  return rpc<RepeatWatch>('repeat_fault_watch', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_days: params.days ?? 90,
    p_threshold: params.threshold ?? 3,
  });
}

/** One job's line, for the job sheet. Callable by whoever can see the job. */
export async function fetchRepeatFaultCount(
  token: string,
  taskId: string,
  days = 90,
): Promise<RepeatCount> {
  return rpc<RepeatCount>('repeat_fault_count', {
    p_token: token,
    p_task_id: taskId,
    p_days: days,
  });
}
