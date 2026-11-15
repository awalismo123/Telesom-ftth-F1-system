import { rpc } from './rpc';
import type { TechWorkload } from './techWorkload';

/**
 * Load and timing per technician.
 *
 * Supervisors and managers only; the function refuses a technician outright.
 * Read-only — every figure is recomputed from `tasks` on each call, so there is
 * nothing stored to go stale and nothing to migrate back out.
 */
export async function fetchTechWorkload(params: {
  token: string;
  groupId: string;
  days?: number;
}): Promise<TechWorkload> {
  return rpc<TechWorkload>('tech_workload', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_days: params.days ?? 30,
  });
}
