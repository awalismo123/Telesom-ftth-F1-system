import { daysFromToday, formatDuration, formatNumber } from './format';
import type { Language } from '../types/database';

/**
 * The audit trail, as data.
 *
 * Two things live here, both pure:
 *
 * 1. **The event feed** — one shape for job changes, dispatch sends,
 *    cancellations and phone-in jobs, with the wording for each. The database
 *    merges four tables (`group_activity`); this module decides what a person
 *    reads.
 * 2. **Aging** — how long a job has been waiting. The department's promise is
 *    three days, so a job is `due` on day three and `late` after it. That is a
 *    rule, not a colour, so it is testable.
 */

export type ActivityKind =
  | 'imported'
  | 'assigned'
  | 'started'
  | 'paused'
  | 'blocked'
  | 'resumed'
  | 'completed'
  | 'reopened'
  | 'cancelled'
  | 'dispatched'
  | 'manual_created';

export interface ActivityEvent {
  at: string;
  kind: string;
  subject: 'job' | 'dispatch';
  task_id: string | null;
  line_number: string | null;
  customer_name: string | null;
  actor: string;
  seconds: number | null;
  dbm: number | string | null;
  reason: string | null;
  notes: string | null;
  channel: string | null;
  task_count: number | null;
}

/**
 * An unknown kind arriving from the server is possible — a future migration
 * could add one. It renders as itself rather than as `undefined`, because a feed
 * that silently loses rows is worse than one with an ugly word in it.
 */
const KNOWN_KINDS: ActivityKind[] = [
  'imported',
  'assigned',
  'started',
  'paused',
  'blocked',
  'resumed',
  'completed',
  'reopened',
  'cancelled',
  'dispatched',
  'manual_created',
];

export function isKnownKind(kind: string): kind is ActivityKind {
  return (KNOWN_KINDS as string[]).includes(kind);
}

const LABELS: Record<ActivityKind, { en: string; so: string }> = {
  imported: { en: 'Imported', so: 'La soo geliyay' },
  assigned: { en: 'Assigned', so: 'La qoondeeyay' },
  started: { en: 'Started', so: 'La bilaabay' },
  paused: { en: 'Paused', so: 'La hakiyay' },
  blocked: { en: 'Blocked', so: 'La xayiray' },
  resumed: { en: 'Resumed', so: 'Dib loo bilaabay' },
  completed: { en: 'Completed', so: 'La dhammeeyay' },
  reopened: { en: 'Reopened', so: 'Dib loo furay' },
  cancelled: { en: 'Cancelled', so: 'La tirtiray' },
  dispatched: { en: 'Plan sent', so: 'Qorshe la diray' },
  manual_created: { en: 'Added by phone', so: 'Telefoon lagu daray' },
};

export function activityLabel(kind: string, lang: Language): string {
  if (isKnownKind(kind)) return LABELS[kind][lang];
  return kind.replace(/_/g, ' ');
}

export type ActivityTone = 'neutral' | 'good' | 'warn' | 'bad';

/** What the dot next to an event means, so colour is never the only signal. */
export function activityTone(kind: string): ActivityTone {
  switch (kind) {
    case 'completed':
      return 'good';
    case 'blocked':
    case 'cancelled':
      return 'bad';
    case 'paused':
    case 'reopened':
    case 'manual_created':
      return 'warn';
    default:
      return 'neutral';
  }
}

const CHANNELS: Record<string, { en: string; so: string }> = {
  clipboard: { en: 'copied', so: 'la nuqulay' },
  share: { en: 'shared', so: 'la wadaagay' },
  whatsapp: { en: 'WhatsApp', so: 'WhatsApp' },
  telegram: { en: 'Telegram', so: 'Telegram' },
};

const BLOCKERS: Record<string, { en: string; so: string }> = {
  customer_unreachable: { en: 'customer unreachable', so: 'macmiil lama helin' },
  fiber_break: { en: 'fiber break', so: 'fiiber jab' },
  box_full: { en: 'box full', so: 'sanduuq buuxa' },
  hardware_defective: { en: 'hardware faulty', so: 'qalab xun' },
  other: { en: 'other', so: 'kale' },
};

/**
 * The second line of an event: the numbers and the reason, never a repeat of
 * the label. Returns `null` when the event says everything in its title.
 */
export function activityDetail(event: ActivityEvent, lang: Language): string | null {
  const parts: string[] = [];

  if (event.kind === 'completed') {
    if (event.dbm !== null && event.dbm !== undefined && event.dbm !== '') {
      parts.push(`${Number(event.dbm).toFixed(1)} dBm`);
    }
    if (event.seconds && event.seconds > 0) parts.push(formatDuration(event.seconds));
  }

  if (event.kind === 'dispatched') {
    if (event.channel) parts.push(CHANNELS[event.channel]?.[lang] ?? event.channel);
    if (event.task_count !== null && event.task_count !== undefined) {
      parts.push(
        lang === 'so' ? `${formatNumber(event.task_count)} shaqo` : `${formatNumber(event.task_count)} jobs`,
      );
    }
  }

  if (event.kind === 'blocked' && event.reason) {
    parts.push(BLOCKERS[event.reason]?.[lang] ?? event.reason);
  }

  if ((event.kind === 'cancelled' || event.kind === 'reopened') && event.reason) {
    parts.push(event.reason.replace(/_/g, ' '));
  }

  const note = event.notes?.trim();
  if (note && event.kind !== 'assigned') parts.push(note);

  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface ActivityFilter {
  kind?: ActivityKind | 'all';
  actor?: string | 'all';
  query?: string;
}

/** Filter by kind, by person, and by whatever is typed in the box. */
export function filterEvents(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  const query = (filter.query ?? '').trim().toLowerCase();

  return events.filter((event) => {
    if (filter.kind && filter.kind !== 'all' && event.kind !== filter.kind) return false;
    if (filter.actor && filter.actor !== 'all' && event.actor !== filter.actor) return false;
    if (!query) return true;

    return [event.line_number, event.customer_name, event.actor, event.notes, event.reason]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

/** How many events of each kind — the chips above the feed. */
export function countByKind(events: ActivityEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

/** Every person who appears in the feed, for the filter. */
export function actorsIn(events: ActivityEvent[]): string[] {
  return [...new Set(events.map((event) => event.actor).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The feed as a spreadsheet. Header in the language of the export, because the
 * person opening it is the person who pressed the button.
 */
export function buildActivityCsv(events: ActivityEvent[], lang: Language): string {
  const headers =
    lang === 'so'
      ? ['Waqti', 'Ficil', 'Khad', 'Macmiil', 'Qofka', 'Faahfaahin']
      : ['When', 'Action', 'Line', 'Customer', 'Who', 'Detail'];

  const rows = events.map((event) => [
    event.at,
    activityLabel(event.kind, lang),
    event.line_number ?? '',
    event.customer_name ?? '',
    event.actor,
    activityDetail(event, lang) ?? '',
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/* -------------------------------------------------------------------------- */
/* Aging                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The department's promise. A job is not late on the day it arrives; it is due
 * on the third day and late on the fourth.
 */
export const SLA_DAYS = 3;

export type AgingBand = 'fresh' | 'due' | 'late';

/**
 * Whole days a job has been waiting, from the day it was reported.
 *
 * `reported_date` is what the sheet says; `created_at` is when we read it, which
 * can be a day later. The customer measures from the first one.
 */
export function waitingDays(
  task: { reported_date?: string | null; created_at?: string | null },
  now: Date = new Date(),
): number | null {
  const from = task.reported_date || task.created_at || null;
  const days = daysFromToday(from, now);
  if (days === null) return null;
  return Math.max(0, -days);
}

export function agingBand(days: number | null, sla = SLA_DAYS): AgingBand {
  if (days === null) return 'fresh';
  if (days > sla) return 'late';
  if (days === sla) return 'due';
  return 'fresh';
}

/** `3 maalmood` / `3 days` — with the singular Somali form after the numeral. */
export function agingLabel(days: number, lang: Language): string {
  if (days <= 0) return lang === 'so' ? 'Maanta' : 'Today';
  if (lang === 'so') return `${formatNumber(days)} maalmood`;
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** How many open jobs have passed the promise. */
export function countLate(
  tasks: { status?: string | null; reported_date?: string | null; created_at?: string | null }[],
  now: Date = new Date(),
  sla = SLA_DAYS,
): { due: number; late: number } {
  let due = 0;
  let late = 0;

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') continue;
    const band = agingBand(waitingDays(task, now), sla);
    if (band === 'late') late += 1;
    else if (band === 'due') due += 1;
  }

  return { due, late };
}
