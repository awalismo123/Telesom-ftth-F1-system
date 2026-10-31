/**
 * Batch E logic that does not need React, a database or a browser.
 *
 * Everything here is pure so it can be unit-tested: what makes a valid phone-in
 * job, when a box code is a duplicate, how a cancellation reads in each
 * language, and which alerts a technician or supervisor should see. The screens
 * stay thin and the rules stay in one place.
 */

import { OPEN_TASK_STATUSES, type TaskStatus, type TaskType } from '../types/database';

export type Lang = 'so' | 'en';

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export function isOpen(status: string): boolean {
  return OPEN_TASK_STATUSES.includes(status as TaskStatus);
}

export function isFinished(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}

export const STATUS_LABEL: Record<TaskStatus, { en: string; so: string }> = {
  unassigned: { en: 'In the pool', so: 'Guddiga' },
  assigned: { en: 'Assigned', so: 'La qoondeeyay' },
  in_progress: { en: 'Running', so: 'Socda' },
  blocked: { en: 'Blocked', so: 'Caqabad' },
  completed: { en: 'Completed', so: 'Dhammaad' },
  cancelled: { en: 'Cancelled', so: 'La joojiyay' },
};

export function statusLabel(status: string, lang: Lang): string {
  const entry = STATUS_LABEL[status as TaskStatus];
  if (!entry) return status;
  return entry[lang];
}

/* -------------------------------------------------------------------------- */
/* Cancelling                                                                  */
/* -------------------------------------------------------------------------- */

export interface CancelReason {
  id: string;
  en: string;
  so: string;
}

/**
 * The reasons people actually give on the phone. The database stores the free
 * text that results, so a reason typed by a supervisor is never lost because it
 * did not match a list.
 */
export const CANCEL_REASONS: CancelReason[] = [
  { id: 'customer_request', en: 'Customer cancelled the visit', so: 'Macmiilka ayaa joojiyay booqashada' },
  { id: 'duplicate', en: 'Already covered by another job', so: 'Shaqo kale ayaa daboolaya' },
  { id: 'wrong_details', en: 'Wrong line or address', so: 'Khad ama cinwaan khaldan' },
  { id: 'out_of_area', en: 'Outside our area', so: 'Ka baxsan aaggeenna' },
  { id: 'other', en: 'Other — say why below', so: 'Kale — sababta hoos ku qor' },
];

export function cancelReasonText(reasonId: string, note: string, lang: Lang): string {
  const reason = CANCEL_REASONS.find((item) => item.id === reasonId);
  const base = reason ? reason[lang] : '';
  const extra = note.trim();
  if (reason?.id === 'other') return extra;
  return [base, extra].filter(Boolean).join(' — ');
}

/* -------------------------------------------------------------------------- */
/* Cablebox form                                                               */
/* -------------------------------------------------------------------------- */

export const PORT_OPTIONS = [4, 8, 12, 16, 24, 32] as const;

export interface BoxDraft {
  id: string | null;
  box_code: string;
  xaafada: string;
  olt_path: string;
  total_ports: number;
  location_notes: string;
}

export interface BoxLookup {
  id: string;
  box_code: string;
  xaafada?: string | null;
  health_status?: string | null;
}

export const emptyBoxDraft = (): BoxDraft => ({
  id: null,
  box_code: '',
  xaafada: '',
  olt_path: '',
  total_ports: 8,
  location_notes: '',
});

export function boxDraftFrom(box: {
  id: string;
  box_code: string;
  xaafada: string | null;
  olt_path: string | null;
  total_ports: number;
  location_notes?: string | null;
}): BoxDraft {
  return {
    id: box.id,
    box_code: box.box_code,
    xaafada: box.xaafada ?? '',
    olt_path: box.olt_path ?? '',
    total_ports: box.total_ports,
    location_notes: box.location_notes ?? '',
  };
}

/**
 * The importer's normalisation, applied in the form too, so what the duplicate
 * check sees is exactly what the database will see: "fat 48" → "FAT 48".
 */
export function normaliseBoxCode(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface BoxValidation {
  errors: Partial<Record<keyof BoxDraft, string>>;
  /** an existing box with the same normalised code (never the one being edited) */
  duplicate: BoxLookup | null;
  normalisedCode: string;
}

export function validateBoxDraft(draft: BoxDraft, existing: BoxLookup[], lang: Lang): BoxValidation {
  const errors: Partial<Record<keyof BoxDraft, string>> = {};
  const code = normaliseBoxCode(draft.box_code);

  if (!code) {
    errors.box_code = lang === 'so' ? 'Lambarka sanduuqa waa loo baahan yahay' : 'A cablebox code is required';
  } else if (code.length > 24) {
    errors.box_code = lang === 'so' ? 'Aad buu u dheer yahay (24 xaraf)' : 'Too long (24 characters maximum)';
  }

  if (!PORT_OPTIONS.includes(draft.total_ports as (typeof PORT_OPTIONS)[number])) {
    errors.total_ports = lang === 'so' ? 'Xulo 4, 8, 12, 16, 24 ama 32' : 'Choose 4, 8, 12, 16, 24 or 32';
  }

  const duplicate =
    code && errors.box_code === undefined
      ? existing.find(
          (box) => box.id !== draft.id && normaliseBoxCode(box.box_code) === code,
        ) ?? null
      : null;

  return { errors, duplicate, normalisedCode: code };
}

/* -------------------------------------------------------------------------- */
/* Manual (phone-in) job                                                       */
/* -------------------------------------------------------------------------- */

export interface ManualTaskDraft {
  line_number: string;
  customer_name: string;
  customer_phone: string;
  task_type: TaskType;
  priority: 'normal' | 'urgent';
  xaafada: string;
  box_code: string;
  port_number: string;
  complain_type: string;
  notes: string;
  /** '' | 'user:<uuid>' | 'crew:<uuid>' */
  assign_key: string;
}

export const emptyManualDraft = (): ManualTaskDraft => ({
  line_number: '',
  customer_name: '',
  customer_phone: '',
  task_type: 'cilada',
  priority: 'normal',
  xaafada: '',
  box_code: '',
  port_number: '',
  complain_type: '',
  notes: '',
  assign_key: '',
});

export interface ManualValidation {
  errors: Partial<Record<keyof ManualTaskDraft, string>>;
  payload: Record<string, unknown>;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A phone number here is either a local Telesom number (63xxxxxxx) or the same
 * digits with a country code. We do not enforce a country: we enforce that a
 * number a technician can actually dial was captured, and the `tel:` link is
 * built from the same digits.
 */
export function phoneLooksDialable(value: string): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 7 && digits.length <= 15;
}

export function validateManualTask(draft: ManualTaskDraft, lang: Lang): ManualValidation {
  const errors: Partial<Record<keyof ManualTaskDraft, string>> = {};
  const so = lang === 'so';

  const line = draft.line_number.trim();
  const name = draft.customer_name.trim();
  const phone = draft.customer_phone.trim();

  if (!line) errors.line_number = so ? 'Lambarka khadka waa loo baahan yahay' : 'A line number is required';
  else if (line.length < 3) errors.line_number = so ? 'Aad buu u gaaban yahay' : 'That looks too short';

  if (!name) errors.customer_name = so ? 'Magaca macmiilka waa loo baahan yahay' : 'A customer name is required';

  if (phone && !phoneLooksDialable(phone)) {
    errors.customer_phone = so ? 'Lambarka taleefanka ma saxna' : 'That phone number does not look right';
  }

  const port = draft.port_number.trim();
  if (port) {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
      errors.port_number = so ? 'Port waa 1 ilaa 32' : 'Port must be 1 to 32';
    }
  }

  const payload: Record<string, unknown> = {
    line_number: line,
    customer_name: name,
    customer_phone: phone ? digitsOnly(phone) : '',
    task_type: draft.task_type,
    priority: draft.priority,
    xaafada: draft.xaafada.trim(),
    box_code: normaliseBoxCode(draft.box_code),
    port_number: port || '',
    complain_type: draft.complain_type.trim(),
    notes: draft.notes.trim(),
  };

  const [kind, id] = draft.assign_key.split(':');
  if (kind === 'user' && id) payload.assign_user_id = id;
  if (kind === 'crew' && id) payload.assign_crew_id = id;

  return { errors, payload };
}

/* -------------------------------------------------------------------------- */
/* Global search                                                               */
/* -------------------------------------------------------------------------- */

export interface SearchTaskHit {
  id: string;
  line_number: string;
  customer_name: string;
  customer_phone: string | null;
  xaafada: string | null;
  cablebox_code_raw: string | null;
  port_number: number | null;
  status: TaskStatus;
  task_type: string;
  priority: string;
  worker: string | null;
}

export interface SearchBoxHit {
  id: string;
  box_code: string;
  xaafada: string | null;
  olt_path: string | null;
  total_ports: number;
  health_status: string;
  ports_damaged: number;
}

export interface SearchResponse {
  tasks: SearchTaskHit[];
  boxes: SearchBoxHit[];
  query: string;
}

export const EMPTY_SEARCH: SearchResponse = { tasks: [], boxes: [], query: '' };

/** One character matches half the group; wait for a second one. */
export function searchQueryIsUsable(query: string): boolean {
  return query.trim().length >= 2;
}

export function searchHitCount(result: SearchResponse): number {
  return result.tasks.length + result.boxes.length;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export type NotificationKind =
  | 'new_assignment'
  | 'blocker_cleared'
  | 'blocked'
  | 'running_long'
  | 'urgent_pool';

export type NotificationTarget = 'route' | 'dispatch' | 'boxes';

export interface OpsNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  at: string | null;
  tone: 'rose' | 'amber' | 'emerald' | 'sky';
  target: NotificationTarget;
  taskId?: string;
}

export interface NotificationTask {
  id: string;
  line_number: string;
  customer_name: string;
  status: string;
  priority?: string;
  assigned_at?: string | null;
  blocked_at?: string | null;
  active_started_at?: string | null;
  blocker_reason?: string | null;
  worker?: string | null;
}

export interface ResumedLog {
  task_id: string;
  created_at: string;
  notes: string | null;
}

const time = (value?: string | null): number => (value ? new Date(value).getTime() : 0);

/**
 * A technician does not want "3 notifications". They want to know which job is
 * new on their route and which blocked job is moving again.
 */
export function buildTechnicianNotifications({
  tasks,
  resumed,
  seenAt,
  lang,
}: {
  tasks: NotificationTask[];
  resumed: ResumedLog[];
  seenAt: number;
  lang: Lang;
}): OpsNotification[] {
  const so = lang === 'so';
  const out: OpsNotification[] = [];
  const seen = new Set<string>();

  for (const task of tasks) {
    if (task.status !== 'assigned' && task.status !== 'in_progress') continue;
    if (!task.assigned_at || time(task.assigned_at) <= seenAt) continue;
    seen.add(task.id);
    out.push({
      id: `new:${task.id}`,
      kind: 'new_assignment',
      title: so ? 'Shaqo cusub ayaa lagu daray' : 'New job on your route',
      detail: `${task.line_number} · ${task.customer_name}`,
      at: task.assigned_at,
      tone: task.priority === 'urgent' ? 'rose' : 'emerald',
      target: 'route',
      taskId: task.id,
    });
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const log of resumed) {
    const task = byId.get(log.task_id);
    if (!task || seen.has(task.id)) continue;
    if (time(log.created_at) <= seenAt) continue;
    // A resumed log is history. If the job is blocked again right now, telling
    // the technician "the blocker cleared" would send them to a job they cannot
    // start.
    if (task.status === 'blocked' || isFinished(task.status)) continue;
    seen.add(task.id);
    out.push({
      id: `resumed:${task.id}`,
      kind: 'blocker_cleared',
      title: so ? 'Caqabadii waa la furay' : 'Blocker cleared',
      detail: `${task.line_number} · ${task.customer_name}`,
      at: log.created_at,
      tone: 'sky',
      target: 'route',
      taskId: task.id,
    });
  }

  return out.sort((a, b) => time(b.at) - time(a.at));
}

/**
 * A supervisor wants the two things that need a decision right now: a job with
 * a blocker, and a job that has been running far too long.
 */
export function buildSupervisorNotifications({
  tasks,
  now,
  longMinutes = 120,
  lang,
}: {
  tasks: NotificationTask[];
  now: number;
  longMinutes?: number;
  lang: Lang;
}): OpsNotification[] {
  const so = lang === 'so';
  const out: OpsNotification[] = [];

  for (const task of tasks) {
    if (task.status === 'blocked') {
      out.push({
        id: `blocked:${task.id}`,
        kind: 'blocked',
        title: so ? 'Shaqo caqabad ku haysata' : 'Job blocked',
        detail: `${task.line_number} · ${task.customer_name}${
          task.blocker_reason ? ` · ${task.blocker_reason.replace(/_/g, ' ')}` : ''
        }`,
        at: task.blocked_at ?? null,
        tone: 'amber',
        target: 'dispatch',
        taskId: task.id,
      });
      continue;
    }

    if (task.status === 'in_progress' && task.active_started_at) {
      const minutes = Math.floor((now - time(task.active_started_at)) / 60000);
      if (minutes >= longMinutes) {
        out.push({
          id: `long:${task.id}`,
          kind: 'running_long',
          title: so ? `Shaqo ${Math.floor(minutes / 60)}h socota` : `Running ${Math.floor(minutes / 60)}h`,
          detail: `${task.line_number} · ${task.customer_name}${task.worker ? ` · ${task.worker}` : ''}`,
          at: task.active_started_at,
          tone: 'rose',
          target: 'dispatch',
          taskId: task.id,
        });
      }
    }
  }

  return out.sort((a, b) => time(b.at) - time(a.at));
}

/** Always show the most urgent first: blocked, then long-running, then new. */
export const NOTIFICATION_ORDER: NotificationKind[] = [
  'blocked',
  'running_long',
  'new_assignment',
  'blocker_cleared',
  'urgent_pool',
];
