/**
 * The jobs that reach the promise today.
 *
 * Everything else on the supervisor's screen measures jobs that have **already**
 * broken the three-day promise. Those are lost; the useful question is which
 * jobs are at the deadline *right now*, because acting on those still keeps it.
 *
 * ## The deadline does not move
 *
 * `SLA_DAYS` is 3 and stays 3. It is a promise to customers, it is pinned in
 * `tests/sla.test.ts`, and a warning list is not evidence for changing it.
 *
 * A job is **due** on the day it reaches three days and **late** the day after —
 * the same boundary as `agingBand` (`days === sla` → due) and as
 * `waiting_over_sla` in SQL (`< now() - interval '3 days'`, strictly less).
 */

import { SLA_DAYS } from './activity';

export interface DueJob {
  id: string;
  line_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  xaafada: string | null;
  cablebox_code_raw: string | null;
  status: string;
  priority: string;
  reported_date: string;
  days_waiting: number;
  assignee: string | null;
  is_unassigned: boolean;
}

export interface SlaWatch {
  sla_days: number;
  today: string;
  due_today: DueJob[];
  due_count: number;
  late_count: number;
  open_count: number;
  unassigned_due: number;
  server_now: string;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Who to ring first.
 *
 * Unassigned jobs come first because nobody is going to touch them otherwise;
 * urgent comes next; then the oldest report, because it has the least time left.
 * Alphabetical by line number breaks the final tie so the order is stable
 * between renders and two supervisors reading the same screen see the same list.
 */
export function urgentFirst(jobs: readonly DueJob[]): DueJob[] {
  return [...jobs].sort(
    (a, b) =>
      Number(b.is_unassigned) - Number(a.is_unassigned) ||
      Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
      String(a.reported_date).localeCompare(String(b.reported_date)) ||
      String(a.line_number).localeCompare(String(b.line_number)),
  );
}

/** Is this job exactly at the deadline — due, not yet late? */
export function isDueToday(job: DueJob, slaDays: number = SLA_DAYS): boolean {
  return job.days_waiting === slaDays;
}

/**
 * The list as the panel should print it.
 *
 * Filtered through `isDueToday` rather than trusting the server's WHERE clause
 * alone: if the two ever disagree the panel must not show a late job as "due
 * today", because that is the one claim that would send a supervisor looking in
 * the wrong place.
 */
export function dueToday(watch: SlaWatch | null | undefined): DueJob[] {
  if (!watch) return [];
  const sla = watch.sla_days ?? SLA_DAYS;
  return urgentFirst(watch.due_today.filter((job) => isDueToday(job, sla)));
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The headline sentence.
 *
 * Written so that a supervisor who reads only this line knows whether to act.
 * It never says "SLA" — the acronym means nothing to a technician and the
 * department talks about "three days".
 */
export function slaHeadline(watch: SlaWatch | null | undefined, lang: 'en' | 'so'): string {
  if (!watch) return '';
  const due = watch.due_count;
  const days = watch.sla_days ?? SLA_DAYS;

  if (due === 0) {
    return lang === 'so'
      ? `Maanta shaqo ma gaarto ${days} maalmood.`
      : `No job reaches ${days} days today.`;
  }

  if (lang === 'so') {
    const base = `${due} shaqo maanta ayay gaartaa ${days} maalmood`;
    return watch.unassigned_due > 0
      ? `${base} — ${watch.unassigned_due} cidna lama qorin.`
      : `${base} — hadda la qabto, waqtigeeda lagu dhammeeyaa.`;
  }

  const base = `${due} job${due === 1 ? '' : 's'} reach${due === 1 ? 'es' : ''} ${days} days today`;
  return watch.unassigned_due > 0
    ? `${base} — ${watch.unassigned_due} with nobody assigned.`
    : `${base} — act now and the promise still holds.`;
}

/** Heading on the card. */
export function slaHeading(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'Maanta waqtiga dhammaanaya' : "Due today";
}

/** The sentence that stops this being read as another overdue counter. */
export const SLA_NOTE = {
  en: 'These jobs reach the three-day promise today. They are not late yet. Acting on them now still keeps it.',
  so: 'Shaqooyinkan maanta ayay gaaraan ballanta saddexda maalmood. Weli ma daahin. Hadda la qabto, ballanta waa la ilaalinayaa.',
} as const;

/** Late jobs are counted separately so this list is never confused with them. */
export function lateNote(count: number, lang: 'en' | 'so'): string | null {
  if (count <= 0) return null;
  return lang === 'so'
    ? `${count} shaqo ayaa hore u daahday — kuwani maanta kama mid aha.`
    : `${count} job${count === 1 ? ' has' : 's have'} already passed the deadline — they are not in this list.`;
}
