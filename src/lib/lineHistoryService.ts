import { rpc } from './rpc';
import type { LineHistory } from './lineHistory';

/**
 * Every job recorded against a line, newest first.
 *
 * Read-only and computed at query time, so it is never stale and there is
 * nothing to migrate back out. `excludeTaskId` is the job being looked at: a job
 * is not part of its own past, and the current row would otherwise crowd the top
 * of the list.
 */
export async function fetchLineHistory(params: {
  token: string;
  groupId: string;
  lineNumber: string;
  excludeTaskId?: string | null;
  limit?: number;
}): Promise<LineHistory> {
  return rpc<LineHistory>('line_history', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_line_number: params.lineNumber,
    p_exclude_task_id: params.excludeTaskId ?? null,
    p_limit: params.limit ?? 20,
  });
}
