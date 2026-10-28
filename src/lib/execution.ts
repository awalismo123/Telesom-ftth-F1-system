/**
 * Execution logic for the technician app — timers, blockers, optical readings.
 *
 * Pure functions only. The clock is always derived from the *server* timestamps
 * on the task (`active_started_at`, `accumulated_seconds`), never from a local
 * stopwatch, so locking the phone, closing the app or reloading cannot lose or
 * invent time, and a wrong phone clock cannot fake a duration.
 */

import type { BlockerReason, Task } from '../types/database';

/* -------------------------------------------------------------------------- */
/* Route payload                                                               */
/* -------------------------------------------------------------------------- */

export interface BoxIssue {
  event_type: string;
  port_number: number | null;
  notes: string | null;
  created_at: string;
}

export interface RouteTask extends Task {
  damaged_ports: number[] | null;
  cablebox_health: 'healthy' | 'warning' | 'critical' | null;
  cablebox_ports: number | null;
  cablebox_notes: string | null;
  cablebox_olt_path: string | null;
  box_issues: BoxIssue[];
}

export interface RouteResponse {
  tasks: RouteTask[];
  crews: string[];
  server_now: string;
  user: { id: string; full_name: string; role: string };
}

/* -------------------------------------------------------------------------- */
/* Clock                                                                       */
/* -------------------------------------------------------------------------- */

/** Seconds a job has taken so far, including the running session. */
export function elapsedSeconds(task: Task, serverNowMs: number): number {
  const base = task.accumulated_seconds ?? 0;
  if (!task.active_started_at) return Math.max(0, base);

  const started = Date.parse(task.active_started_at);
  if (!Number.isFinite(started)) return Math.max(0, base);

  // Clamp the *session*, not the total: a phone clock that is ahead of the
  // server must not wipe out time that was already banked.
  return Math.max(0, base) + Math.max(0, Math.floor((serverNowMs - started) / 1000));
}

/** `3725` → `01:02:05`; under an hour → `02:05`. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `3725` → `1h 02m` (the compact form used in lists and messages). */
export function formatDuration(totalSeconds: number, lang: 'so' | 'en' = 'en'): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return lang === 'so' ? `${h}s ${m}d` : `${h}h ${m}m`;
  if (m > 0) return lang === 'so' ? `${m}d ${s}s` : `${m}m ${s}s`;
  return lang === 'so' ? `${s}s` : `${s}s`;
}

/** Offset between the server clock and this phone, in milliseconds. */
export function serverOffsetMs(serverNow: string, receivedAt = Date.now()): number {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/* -------------------------------------------------------------------------- */
/* Blockers                                                                    */
/* -------------------------------------------------------------------------- */

export interface BlockerDef {
  id: BlockerReason;
  labelEn: string;
  labelSo: string;
  hintEn: string;
  hintSo: string;
  /** what the technician should do next */
  actionEn: string;
  actionSo: string;
  tone: 'amber' | 'rose' | 'sky' | 'slate';
}

export const BLOCKERS: BlockerDef[] = [
  {
    id: 'customer_unreachable',
    labelEn: 'Customer unreachable',
    labelSo: 'Macmiilka lama helin',
    hintEn: 'Phone off, no answer, or nobody at home',
    hintSo: 'Telefoonka damisan, jawaab ma jirin, ama qof guriga ma joogo',
    actionEn: 'Call again later today, then report back to the supervisor.',
    actionSo: 'Mar kale wac maanta, kadibna kormeeraha u sheeg.',
    tone: 'amber',
  },
  {
    id: 'fiber_break',
    labelEn: 'Fiber break',
    labelSo: 'Fiber jab',
    hintEn: 'Cut or crushed fibre — needs a splice',
    hintSo: 'Fiber go’an ama jabay — wuxuu u baahan yahay isku-xir',
    actionEn: 'The cablebox is flagged and the supervisor is notified.',
    actionSo: 'Cablebox-ka waa la calaamadeeyay kormeerahana waa la wargeliyay.',
    tone: 'rose',
  },
  {
    id: 'box_full',
    labelEn: 'Box full',
    labelSo: 'Box buuxa',
    hintEn: 'No free port left on this cablebox',
    hintSo: 'Port banaan kama hadhin cablebox-kan',
    actionEn: 'Raise it for a box upgrade or a new split.',
    actionSo: 'U qaad kor u qaadid box ama split cusub.',
    tone: 'rose',
  },
  {
    id: 'hardware_defective',
    labelEn: 'Hardware defective',
    labelSo: 'Qalab xumaaday',
    hintEn: 'Router, ONT or splitter is faulty',
    hintSo: 'Router, ONT ama splitter ayaa xumaaday',
    actionEn: 'Note the serial number and request a replacement.',
    actionSo: 'Qor lambarka siriyaha oo codso beddel.',
    tone: 'sky',
  },
  {
    id: 'other',
    labelEn: 'Other problem',
    labelSo: 'Dhibaato kale',
    hintEn: 'Anything else — describe it below',
    hintSo: 'Wax kale — hoos ku sharax',
    actionEn: 'Your note goes to the supervisor straight away.',
    actionSo: 'Qoraalkaagu isla markiiba kormeeraha ayuu gaarayaa.',
    tone: 'slate',
  },
];

export function blockerById(id: BlockerReason | null | undefined): BlockerDef | null {
  if (!id) return null;
  return BLOCKERS.find((b) => b.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Optical power                                                               */
/* -------------------------------------------------------------------------- */

export interface DbmCheck {
  /** the value to submit, or null when the input cannot be used */
  value: number | null;
  /** blocking problem, if any */
  error: string | null;
  /** non-blocking warning (weak signal) */
  warning: string | null;
}

/**
 * Telesom techs type what the power meter shows. Two realities:
 *   • they often drop the minus sign (`21.5` means −21.5 dBm);
 *   • anything between −8 and −27 dBm is healthy, below −27 needs a second look.
 */
export function parseDbm(raw: string): DbmCheck {
  const cleaned = (raw ?? '').replace(',', '.').replace(/[^\d.\-]/g, '').trim();

  if (!cleaned || cleaned === '-' || cleaned === '.') {
    return { value: null, error: 'Enter the reading from the power meter', warning: null };
  }

  let value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return { value: null, error: 'That is not a number', warning: null };
  }

  // Optical power is always negative for a working drop.
  if (value > 0) value = -value;

  if (value < -40) {
    return { value: null, error: 'Too low to be real (limit −40 dBm)', warning: null };
  }

  const rounded = Math.round(value * 100) / 100;

  if (rounded > -8) {
    return {
      value: rounded,
      error: null,
      warning: 'Very strong — check you are on the right port',
    };
  }

  if (rounded < -27) {
    return {
      value: rounded,
      error: null,
      warning: 'Weak signal — clean the connector before you finish',
    };
  }

  return { value: rounded, error: null, warning: null };
}

/** Quick-pick values covering the readings seen on Telesom drops. */
export const DBM_PRESETS = [-15, -18, -20, -22, -24, -26];

export function dbmTone(value: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (value === null) return 'none';
  if (value >= -27 && value <= -8) return 'good';
  if (value < -27) return 'bad';
  return 'warn';
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

export function isOpen(task: Task): boolean {
  return task.status !== 'completed';
}

/** Running first, then blocked, then urgent, then oldest. */
export function sortRoute(tasks: RouteTask[]): RouteTask[] {
  const rank = (t: Task) =>
    t.status === 'in_progress' ? 0 : t.status === 'blocked' ? 1 : t.status === 'completed' ? 3 : 2;

  return [...tasks].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
    const da = a.reported_date ?? '';
    const db = b.reported_date ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.line_number.localeCompare(b.line_number);
  });
}

export interface RouteSection {
  key: string;
  label: string;
  sublabel: string | null;
  tasks: RouteTask[];
}

/** Group the route by cablebox, then by neighbourhood — the order of the day. */
export function groupRoute(tasks: RouteTask[], lang: 'so' | 'en'): RouteSection[] {
  const sections = new Map<string, RouteSection>();

  for (const task of sortRoute(tasks)) {
    if (task.status === 'completed') continue;

    const box = task.cablebox_code_raw?.trim() || null;
    const area = task.xaafada?.trim() || null;
    const key = box ? `box:${box.toUpperCase()}` : area ? `area:${area.toUpperCase()}` : 'none';

    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        label: box ?? area ?? (lang === 'so' ? 'Xaafad la’aan' : 'No area'),
        sublabel: box && area ? area : null,
        tasks: [],
      };
      sections.set(key, section);
    }
    section.tasks.push(task);
  }

  return [...sections.values()];
}

export interface RouteStats {
  open: number;
  urgent: number;
  running: number;
  blocked: number;
  doneToday: number;
  doneSeconds: number;
}

export function routeStats(tasks: RouteTask[]): RouteStats {
  const today = new Date().toISOString().slice(0, 10);

  return tasks.reduce<RouteStats>(
    (acc, task) => {
      if (task.status === 'completed') {
        if ((task.completed_at ?? '').slice(0, 10) === today) {
          acc.doneToday += 1;
          acc.doneSeconds += task.accumulated_seconds ?? 0;
        }
        return acc;
      }

      acc.open += 1;
      if (task.priority === 'urgent') acc.urgent += 1;
      if (task.status === 'in_progress') acc.running += 1;
      if (task.status === 'blocked') acc.blocked += 1;
      return acc;
    },
    { open: 0, urgent: 0, running: 0, blocked: 0, doneToday: 0, doneSeconds: 0 },
  );
}

/* -------------------------------------------------------------------------- */
/* Warnings shown on a route card                                              */
/* -------------------------------------------------------------------------- */

export interface TaskWarning {
  key: string;
  tone: 'amber' | 'rose' | 'sky';
  textEn: string;
  textSo: string;
}

export function taskWarnings(task: RouteTask): TaskWarning[] {
  const warnings: TaskWarning[] = [];

  // Router not collected yet (Galinta "XNumber": Qaatay / Muu).
  if (task.router_state === 'not_collected') {
    warnings.push({
      key: 'router',
      tone: 'rose',
      textEn: 'Router not collected — the customer must pick it up first',
      textSo: 'Router lama qaadan — macmiilka waa inuu marka hore qaataa',
    });
  }

  // The exact port this job needs is recorded as damaged.
  const port = task.port_number;
  if (port !== null && port !== undefined && (task.damaged_ports ?? []).includes(port)) {
    warnings.push({
      key: 'damaged-port',
      tone: 'rose',
      textEn: `Port ${port} is marked damaged on ${task.cablebox_code_raw ?? 'this box'} — use another port and note it`,
      textSo: `Port ${port} waa dhaawac ${task.cablebox_code_raw ?? 'box-kan'} — isticmaal port kale oo qor`,
    });
  } else if ((task.damaged_ports ?? []).length > 0) {
    warnings.push({
      key: 'damaged-others',
      tone: 'amber',
      textEn: `Damaged port(s) on this box: ${(task.damaged_ports ?? []).join(', ')}`,
      textSo: `Port-yada dhaawac: ${(task.damaged_ports ?? []).join(', ')}`,
    });
  }

  if (task.cablebox_health === 'critical') {
    warnings.push({
      key: 'box-health',
      tone: 'rose',
      textEn: 'This cablebox is flagged critical — box full or repeated faults',
      textSo: 'Cablebox-kan waa mid halis ah — box buuxa ama cilado soo noqnoqday',
    });
  }

  if ((task.carryover_count ?? 0) > 0) {
    warnings.push({
      key: 'carry',
      tone: 'amber',
      textEn: `Carried over from ${task.reported_date ?? 'an earlier day'} (${task.carryover_count}×)`,
      textSo: `Harsan ${task.reported_date ?? 'maalin hore'} (${task.carryover_count}×)`,
    });
  }

  if (task.is_repeat_fault) {
    warnings.push({
      key: 'repeat',
      tone: 'sky',
      textEn: 'Repeat fault — this customer has been fixed before',
      textSo: 'Cilad soo noqotay — macmiilkan hore ayaa la hagaajiyay',
    });
  }

  return warnings;
}
