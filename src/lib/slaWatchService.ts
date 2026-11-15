import { rpc } from './rpc';
import type { SlaWatch } from './slaWatch';

/**
 * Jobs reaching the three-day promise today.
 *
 * Read-only and computed from `reported_date` on every call, so nothing is
 * stored and no deadline is written anywhere. Supervisors and managers only.
 */
export async function fetchSlaWatch(token: string, groupId: string): Promise<SlaWatch> {
  return rpc<SlaWatch>('sla_watch', { p_token: token, p_group_id: groupId });
}
