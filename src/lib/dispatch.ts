/**
 * Dispatch logic — route clustering, automatic balancing and the group-chat
 * message. Pure functions only: no React, no Supabase, so every rule below can
 * be reasoned about (and tested) on its own.
 *
 * The rules follow how Group F1 actually works:
 *   • a job belongs to a cablebox first and to a neighbourhood second;
 *   • urgent tickets must never be buried at the bottom of a list;
 *   • one crew should not be given the whole city while another sits idle;
 *   • the dispatch message is copied into WhatsApp, so it must be short,
 *     readable on a phone, and identical in Somali and English structure.
 */

import type { Task } from '../types/database';

/* -------------------------------------------------------------------------- */
/* Targets (a technician or a 2-person crew)                                   */
/* -------------------------------------------------------------------------- */

export type TargetKind = 'crew' | 'user';

export interface DispatchTarget {
  kind: TargetKind;
  id: string;
  name: string;
  /** crew members / vehicle tag — shown under the name */
  subtitle: string | null;
  /** the area a crew prefers, used as a soft hint when auto-planning */
  zoneFocus: string | null;
  openJobs: number;
  urgentJobs: number;
  activeJobs: number;
  doneToday: number;
}

export function targetKey(target: Pick<DispatchTarget, 'kind' | 'id'>): string {
  return `${target.kind}:${target.id}`;
}

/* -------------------------------------------------------------------------- */
/* Clustering                                                                  */
/* -------------------------------------------------------------------------- */

export type ClusterKind = 'box' | 'area' | 'none';

export interface RouteCluster {
  id: string;
  kind: ClusterKind;
  /** canonical key used for grouping (upper-cased box code / lower area) */
  key: string;
  label: string;
  area: string | null;
  box: string | null;
  tasks: Task[];
  urgentCount: number;
  carryoverCount: number;
}

const NO_AREA_LABEL = 'No area / box';

function boxKey(raw: string | null | undefined): string | null {
  const value = (raw ?? '').toUpperCase().replace(/\s+/g, '');
  if (!value) return null;
  // Keep only the box part: "FAT48-3" → "FAT48", "B6(52)" → "B6".
  const fat = value.match(/FAT\s*-?\s*([A-Z0-9]+)/);
  if (fat) return `FAT${fat[1]}`;
  const plain = value.match(/^([A-Z]{0,4}\d+[A-Z0-9]*)/);
  return plain ? plain[1] : value.slice(0, 12);
}

function areaKey(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  return value ? value.toUpperCase() : null;
}

/** Urgent first, then the job that has been waiting longest. */
export function compareTasks(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
  const carry = (b.carryover_count ?? 0) - (a.carryover_count ?? 0);
  if (carry !== 0) return carry;
  const da = a.reported_date ?? '';
  const db = b.reported_date ?? '';
  if (da !== db) return da < db ? -1 : 1;
  return a.line_number.localeCompare(b.line_number);
}

/**
 * Group jobs by cablebox, falling back to the neighbourhood. Jobs with neither
 * end up in a single bucket the supervisor must handle by hand.
 */
export function clusterTasks(tasks: Task[]): RouteCluster[] {
  const buckets = new Map<string, RouteCluster>();

  for (const task of tasks) {
    const box = boxKey(task.cablebox_code_raw);
    const area = areaKey(task.xaafada);
    const kind: ClusterKind = box ? 'box' : area ? 'area' : 'none';
    const key = box ? `box:${box}` : area ? `area:${area}` : 'none:';
    // Keep what is printed on the sheet for display (`B6 (52)`), use the
    // canonical key for grouping.
    const label = box ? (task.cablebox_code_raw ?? box).trim() : task.xaafada?.trim() ?? NO_AREA_LABEL;

    let cluster = buckets.get(key);
    if (!cluster) {
      cluster = {
        id: key,
        kind,
        key,
        label,
        area: task.xaafada?.trim() ?? null,
        box: box ?? null,
        tasks: [],
        urgentCount: 0,
        carryoverCount: 0,
      };
      buckets.set(key, cluster);
    }

    cluster.tasks.push(task);
    if (task.priority === 'urgent') cluster.urgentCount += 1;
    cluster.carryoverCount += task.carryover_count ?? 0;
    // Prefer the area recorded on a job that actually has one.
    if (!cluster.area && task.xaafada) cluster.area = task.xaafada.trim();
  }

  const clusters = [...buckets.values()];
  for (const cluster of clusters) cluster.tasks.sort(compareTasks);

  return clusters.sort((a, b) => {
    const urgent = b.urgentCount - a.urgentCount;
    if (urgent !== 0) return urgent;
    if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
    return a.label.localeCompare(b.label);
  });
}

/** A cluster bigger than a sane route is cut into chunks of `maxJobs`. */
export function splitLargeClusters(clusters: RouteCluster[], maxJobs: number): RouteCluster[] {
  if (maxJobs <= 0) return clusters;
  const out: RouteCluster[] = [];

  for (const cluster of clusters) {
    if (cluster.tasks.length <= maxJobs) {
      out.push(cluster);
      continue;
    }

    const parts = Math.ceil(cluster.tasks.length / maxJobs);
    for (let i = 0; i < parts; i += 1) {
      const slice = cluster.tasks.slice(i * maxJobs, (i + 1) * maxJobs);
      if (!slice.length) continue;
      out.push({
        ...cluster,
        id: `${cluster.id}#${i + 1}`,
        label: `${cluster.label} (${i + 1}/${parts})`,
        tasks: slice,
        urgentCount: slice.filter((t) => t.priority === 'urgent').length,
        carryoverCount: slice.reduce((sum, t) => sum + (t.carryover_count ?? 0), 0),
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Automatic plan                                                              */
/* -------------------------------------------------------------------------- */

export interface PlannedAssignment {
  cluster: RouteCluster;
  target: DispatchTarget;
  reason: 'zone' | 'same-box' | 'balance';
}

export interface AutoPlan {
  assignments: PlannedAssignment[];
  /** clusters that could not be given to anybody (no targets at all) */
  leftOver: RouteCluster[];
  loads: Record<string, number>;
}

function normaliseZone(value: string | null | undefined): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function zoneMatches(target: DispatchTarget, cluster: RouteCluster): boolean {
  const zone = normaliseZone(target.zoneFocus);
  if (!zone) return false;
  const area = normaliseZone(cluster.area);
  if (!area) return false;
  // "Jigjigayar & Gantalaha" must match a cluster in either neighbourhood.
  return area
    .split(' ')
    .some((word) => word.length > 3 && zone.includes(word));
}

/**
 * Spread the work: urgent clusters are placed first, then the biggest, and each
 * goes to the target that is (a) free, (b) already working that box or area.
 *
 * `maxJobs` is a soft ceiling — a cluster is never split by this function, the
 * caller decides when to split (see `splitLargeClusters`).
 */
export function autoPlan(
  clusters: RouteCluster[],
  targets: DispatchTarget[],
  maxJobs = 6,
): AutoPlan {
  const loads: Record<string, number> = {};
  for (const target of targets) loads[targetKey(target)] = target.openJobs ?? 0;

  const assignments: PlannedAssignment[] = [];
  const leftOver: RouteCluster[] = [];
  const boxesByTarget = new Map<string, Set<string>>();

  const ordered = [...clusters].sort((a, b) => {
    if (b.urgentCount !== a.urgentCount) return b.urgentCount - a.urgentCount;
    return b.tasks.length - a.tasks.length;
  });

  for (const cluster of ordered) {
    if (!targets.length) {
      leftOver.push(cluster);
      continue;
    }

    let best: { target: DispatchTarget; score: number; reason: PlannedAssignment['reason'] } | null =
      null;

    for (const target of targets) {
      const key = targetKey(target);
      const load = loads[key] ?? 0;
      const boxes = boxesByTarget.get(key);

      let score = -load * 2; // fairness dominates
      let reason: PlannedAssignment['reason'] = 'balance';

      if (cluster.box && boxes?.has(cluster.box)) {
        score += 3;
        reason = 'same-box';
      } else if (zoneMatches(target, cluster)) {
        score += 2;
        reason = 'zone';
      }

      // A crew is a better fit for a heavy route, a single tech for a small one.
      if (target.kind === 'crew' && cluster.tasks.length >= 3) score += 0.5;
      if (target.kind === 'user' && cluster.tasks.length <= 1) score += 0.5;

      // Soft ceiling: only blocking when everything else is already over too.
      if (load + cluster.tasks.length > maxJobs) score -= 1.5;

      if (!best || score > best.score) best = { target, score, reason };
    }

    if (!best) {
      leftOver.push(cluster);
      continue;
    }

    const key = targetKey(best.target);
    loads[key] = (loads[key] ?? 0) + cluster.tasks.length;
    if (cluster.box) {
      const set = boxesByTarget.get(key) ?? new Set<string>();
      set.add(cluster.box);
      boxesByTarget.set(key, set);
    }
    assignments.push({ cluster, target: best.target, reason: best.reason });
  }

  return { assignments, leftOver, loads };
}

/* -------------------------------------------------------------------------- */
/* Phones                                                                      */
/* -------------------------------------------------------------------------- */

/** `634418376` → `063 441 8376` (how Telesom writes a mobile number). */
export function formatPhoneLocal(raw: string | null | undefined): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('252')) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 9) return (raw ?? '').trim();
  return `0${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
}

/** `634418376` → `+252634418376` for `tel:` / `wa.me` links. */
export function formatPhoneE164(raw: string | null | undefined): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('252')) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? `+252${digits}` : '';
}

/* -------------------------------------------------------------------------- */
/* The group-chat message                                                      */
/* -------------------------------------------------------------------------- */

export type DispatchLang = 'so' | 'en';

export interface MessageLane {
  target: DispatchTarget;
  tasks: Task[];
}

export interface MessageOptions {
  groupCode: string;
  date: string;
  lang: DispatchLang;
  /** master template — must contain {blocks} */
  template?: string;
  includePhone?: boolean;
  /** when set, only this lane is rendered (single-crew message) */
  onlyTargetKey?: string;
  /** footer appended to every message */
  footer?: string;
}

export const DEFAULT_TEMPLATES: Record<DispatchLang, string> = {
  en: [
    '*TELESOM {group} — DISPATCH {date}*',
    '{count} jobs · {crewsLabel}',
    '',
    '{blocks}',
    '',
    'Please confirm here when a job is finished. 🙏',
  ].join('\n'),
  so: [
    '*TELESOM {group} — QAYBINTA {date}*',
    '{count} shaqo · {crewsLabel}',
    '',
    '{blocks}',
    '',
    'Fadlan halkan ka xaqiijiya marka shaqadu dhammaato. 🙏',
  ].join('\n'),
};

export const BLOCK_TEMPLATES: Record<DispatchLang, string> = {
  en: ['*{target}* — {count} job(s)', '{lines}'].join('\n'),
  so: ['*{target}* — {count} shaqo', '{lines}'].join('\n'),
};

const URGENT_FLAG: Record<DispatchLang, string> = { en: '⚡URGENT', so: '⚡DEGDEG' };
const CARRY_FLAG: Record<DispatchLang, string> = { en: '↩ carried over', so: '↩ harsan' };

function formatDateForMessage(iso: string, lang: DispatchLang): string {
  // 2026-10-28 → 28/10/2026 (unambiguous for both languages, day first).
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return iso ?? '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function buildJobLine(
  task: Task,
  index: number,
  lang: DispatchLang,
  includePhone: boolean,
): string {
  const parts: string[] = [`${index}. ${task.line_number}`];
  parts.push(task.customer_name || '—');

  const place = task.cablebox_code_raw?.trim() || task.xaafada?.trim();
  if (place) parts.push(place);

  if (includePhone) {
    const phone = formatPhoneLocal(task.customer_phone);
    if (phone) parts.push(`☎ ${phone}`);
  }

  let line = parts.join(' · ');
  if (task.priority === 'urgent') line += ` ${URGENT_FLAG[lang]}`;
  if ((task.carryover_count ?? 0) > 0) line += ` ${CARRY_FLAG[lang]}`;
  return line;
}

export function buildBlock(
  lane: MessageLane,
  lang: DispatchLang,
  includePhone: boolean,
): string {
  const lines = lane.tasks
    .slice()
    .sort(compareTasks)
    .map((task, i) => buildJobLine(task, i + 1, lang, includePhone))
    .join('\n');

  return BLOCK_TEMPLATES[lang]
    .replace('{target}', lane.target.name)
    .replace('{count}', String(lane.tasks.length))
    .replace('{lines}', lines);
}

/**
 * Build the text that goes into WhatsApp/Telegram.
 * `onlyTargetKey` produces the single-crew variant; otherwise one master
 * message with every lane underneath.
 */
export function buildDispatchMessage(lanes: MessageLane[], options: MessageOptions): string {
  const { groupCode, date, lang } = options;
  const includePhone = options.includePhone ?? true;
  const template = (options.template || DEFAULT_TEMPLATES[lang]).trim();

  const selected = options.onlyTargetKey
    ? lanes.filter((lane) => targetKey(lane.target) === options.onlyTargetKey)
    : lanes;

  const withJobs = selected.filter((lane) => lane.tasks.length > 0);
  const blocks = withJobs
    .map((lane) => buildBlock(lane, lang, includePhone))
    .join('\n\n');

  const totalJobs = withJobs.reduce((sum, lane) => sum + lane.tasks.length, 0);
  const crewsLabel =
    lang === 'so'
      ? `${withJobs.length} koox${withJobs.length === 1 ? '' : 'ood'}`
      : `${withJobs.length} team${withJobs.length === 1 ? '' : 's'}`;

  const body = template
    .replace(/\{group\}/g, groupCode)
    .replace(/\{date\}/g, formatDateForMessage(date, lang))
    .replace(/\{count\}/g, String(totalJobs))
    .replace(/\{crews\}/g, String(withJobs.length))
    .replace(/\{crewsLabel\}/g, crewsLabel)
    .replace(/\{blocks\}/g, blocks);

  return body.replace(/\n{3,}/g, '\n\n').trim();
}

/** WhatsApp / Telegram deep links (they open the share sheet with the text). */
export function whatsappLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function telegramLink(message: string): string {
  const text = encodeURIComponent(message);
  return `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${text}`;
}

/* -------------------------------------------------------------------------- */
/* Small helpers used by the board                                             */
/* -------------------------------------------------------------------------- */

export function isPool(task: Task): boolean {
  return task.status === 'unassigned';
}

export function taskPlace(task: Task): string {
  return task.cablebox_code_raw?.trim() || task.xaafada?.trim() || '—';
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  const digits = q.replace(/\D/g, '');
  return tasks.filter((task) => {
    if (task.customer_name?.toLowerCase().includes(q)) return true;
    if (task.line_number?.includes(q)) return true;
    if (digits && (task.customer_phone ?? '').includes(digits)) return true;
    if (task.xaafada?.toLowerCase().includes(q)) return true;
    if (task.cablebox_code_raw?.toLowerCase().includes(q)) return true;
    return false;
  });
}
