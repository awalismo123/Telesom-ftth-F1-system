import { rpc } from './rpc';
import type { BoxFaultHistory } from './boxHistory';

/** Faults per box over a window. Read-only; nothing is stored. */
export async function fetchBoxFaultHistory(params: {
  token: string;
  groupId: string;
  days: number;
}): Promise<BoxFaultHistory> {
  return rpc<BoxFaultHistory>('box_fault_history', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_days: params.days,
  });
}
