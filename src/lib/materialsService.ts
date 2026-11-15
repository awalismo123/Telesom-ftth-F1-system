import { rpc } from './rpc';
import type { MaterialUnit, RecordedMaterial, UsageResponse } from './materials';

/**
 * Thin RPC wrappers. Kept apart from `materials.ts` so the pure validation and
 * formatting logic — which the tests exercise without a database — carries no
 * network import.
 */

export async function addTaskMaterial(params: {
  token: string;
  taskId: string;
  item: string;
  quantity: number;
  unit: MaterialUnit;
}): Promise<{ ok: boolean; material: RecordedMaterial & { group_id: string; task_id: string } }> {
  return rpc('add_task_material', {
    p_token: params.token,
    p_task_id: params.taskId,
    p_item: params.item,
    p_quantity: params.quantity,
    p_unit: params.unit,
  });
}

export async function fetchTaskMaterials(
  token: string,
  taskId: string,
): Promise<RecordedMaterial[]> {
  const result = await rpc<{ task_id: string; materials: RecordedMaterial[] }>('list_task_materials', {
    p_token: token,
    p_task_id: taskId,
  });
  return result.materials ?? [];
}

/** Usage across a group for a date window. Never stock — see `materials.ts`. */
export async function fetchMaterialsUsage(params: {
  token: string;
  groupId: string;
  from: string;
  to: string;
}): Promise<UsageResponse> {
  return rpc<UsageResponse>('materials_usage', {
    p_token: params.token,
    p_group_id: params.groupId,
    p_from: params.from,
    p_to: params.to,
  });
}
