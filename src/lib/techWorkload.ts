/**
 * Who is carrying too much, right now.
 *
 * ## What this module refuses to do
 *
 * It does not rank. There is no `rank`, no `score`, no `position`, and nothing
 * here sorts by jobs closed. The panel orders alphabetically, because a list
 * ordered by output is a leaderboard, and a technician who is measured on jobs
 * closed will close a job before it is fixed.
 *
 * ## Why the median
 *
 * `KNOWN_LIMITS` §7d: the live average is 916 minutes, because one timer was
 * left running for 45.7 hours. The average of three jobs is then entirely that
 * one job. A median ignores it, which is the whole point — it describes the
 * typical job instead of the worst accident.
 *
 * ## Two different problems, kept apart
 *
 * 1. **Impossible** — recorded time longer than the job has existed. Nobody can
 *    work on a job for longer than it has been in the system, so this is
 *    arithmetic, not opinion. The server counts these and excludes them from the
 *    median, and the panel says how many it set aside.
 * 2. **Merely enormous** — a forgotten timer on a job that is old enough to
 *    "plausibly" take 45 hours. Caught by showing the **longest** time beside
 *    the median: the median stays honest and the outlier is still visible.
 *
 * Neither is a judgement about the technician. Both are stated, never hidden.
 */

export interface OpenDay {
  date: string;
  open: number;
}

export interface TechRow {
  user_id: string;
  name: string;
  role: string;
  open_now: number;
  running_now: number;
  blocked_now: number;
  completed: number;
  /** Seconds, plausibly-timed completions only, newest first. */
  durations: number[];
  /** Completions whose recorded time exceeded the job's own age. */
  implausible_timers: number;
  open_by_day: OpenDay[];
}

export interface TechWorkload {
  from: string;
  to: string;
  days: number;
  basis: 'completion';
  techs: TechRow[];
  server_now: string;
}

/* -------------------------------------------------------------------------- */
/* The statistics                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The middle value.
 *
 * Even count: the mean of the two middle values. That is the standard median,
 * and for a duration it says "half the jobs were quicker than this", which is
 * still true of the interpolated figure.
 *
 * Single value: itself. Empty: `null` — not zero. Zero would claim that somebody
 * completed a job in no time at all.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median completed-job duration, in whole minutes. `null` when nothing to say. */
export function medianMinutes(seconds: readonly number[]): number | null {
  const value = median(seconds);
  if (value === null) return null;
  return Math.round(value / 60);
}

/** The longest recorded job, in minutes — the outlier the median hides. */
export function longestMinutes(seconds: readonly number[]): number | null {
  if (seconds.length === 0) return null;
  return Math.round(Math.max(...seconds) / 60);
}

/**
 * Is the longest job so far from the median that it should be pointed out?
 *
 * Four times the median, and at least an hour: below that the noise of a normal
 * working day is enough to trip it, and a warning that fires every day is a
 * warning nobody reads.
 */
export function hasOutlier(seconds: readonly number[]): boolean {
  const mid = medianMinutes(seconds);
  const longest = longestMinutes(seconds);
  if (mid === null || longest === null) return false;
  // A median of 0 minutes cannot be multiplied; use an absolute floor instead.
  if (mid < 5) return longest >= 60;
  return longest >= Math.max(60, mid * 4);
}

/* -------------------------------------------------------------------------- */
/* Ordering — alphabetical, always                                            */
/* -------------------------------------------------------------------------- */

/**
 * Alphabetical by name.
 *
 * Sorted with `localeCompare` so Somali names are ordered the way a reader
 * expects rather than by code point. Ties fall back to the id so the order is
 * stable between renders.
 */
export function alphabetical(techs: readonly TechRow[]): TechRow[] {
  return [...techs].sort(
    (a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id),
  );
}

/**
 * Who belongs on the panel.
 *
 * Every active technician, whether or not they have done anything — a person
 * with no jobs is a fact about the week, not an absence to hide. A supervisor is
 * shown only when they actually closed something themselves, because otherwise
 * they are a row of zeros on a list about technicians.
 */
export function visibleTechs(techs: readonly TechRow[]): TechRow[] {
  return alphabetical(
    techs.filter(
      (tech) =>
        tech.role === 'technician' ||
        tech.completed > 0 ||
        tech.open_now > 0,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Load                                                                       */
/* -------------------------------------------------------------------------- */

/** Open jobs by day, summed. For the "how much is waiting" line. */
export function openTotal(row: TechRow): number {
  return row.open_by_day.reduce((sum, day) => sum + day.open, 0);
}

/**
 * The busiest single day in front of this technician, and which day it is.
 * `null` when they are carrying nothing.
 */
export function peakDay(row: TechRow): OpenDay | null {
  let peak: OpenDay | null = null;
  for (const day of row.open_by_day) {
    if (!peak || day.open > peak.open) peak = day;
  }
  return peak;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Printed inside the panel, not hidden in a tooltip.
 *
 * **This deliberately differs from the draft in the implementation plan**, which
 * said the time "includes travel, waiting for access and blockers". That is not
 * true of this app. Blocking a job pauses the clock (`005_execution.sql`: the
 * running total is banked and `active_started_at` is cleared), and travel is
 * counted only if the technician pressed Start before setting off. A disclaimer
 * that misdescribes its own number is worse than no disclaimer.
 */
export const WORKLOAD_NOTE = {
  en: 'Recorded time is only the stretch a job was marked running. A blocker pauses it; travel before Start, waiting with no blocker, and the gaps between jobs are not counted. It measures the job, not the person.',
  so: 'Waqtiga la diiwaangeliyay waa oo kaliya inta uu shaqadu "socda" ku qornayd. Caqabaddu way joojisaa; safarka ka hor inta aan la bilaabin, sugidda aan caqabad lahayn, iyo waqtiga shaqooyinka dhexdooda lama tiriyo. Waxay cabbirtaa shaqada, ma aha qofka.',
} as const;

/** Heading. Carries the window, always. */
export function workloadLabel(days: number, lang: 'en' | 'so'): string {
  return lang === 'so'
    ? `Culeyska shaqaalaha — ${days} maalmood`
    : `Technician workload — last ${days} days`;
}

/**
 * The label for the middle figure.
 *
 * Says **median** in as many words, because a number labelled "average" that is
 * actually a median is the kind of quiet inaccuracy that gets quoted in a
 * meeting.
 */
export function medianLabel(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'dhexdhexaad' : 'median';
}

/** When some timers were set aside as impossible. Never silent. */
export function implausibleNote(count: number, lang: 'en' | 'so'): string | null {
  if (count <= 0) return null;
  if (lang === 'so') {
    return count === 1
      ? '1 timer wuu ka weynaa da\'da shaqada, lama tiriyo.'
      : `${count} timer ayaa ka weynaa da'da shaqada, lama tiriyo.`;
  }
  return count === 1
    ? '1 timer ran longer than the job had existed, so it is not counted.'
    : `${count} timers ran longer than the job had existed, so they are not counted.`;
}

/** Nothing completed in the window — said plainly rather than left blank. */
export function nothingCompleted(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'Muddoongan shaqo ma dhammeeyin.' : 'Nothing completed in this window.';
}

/** Carrying nothing, in the window. Still a row, still a person. */
export function noLoad(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'Shaqo furan ma hayo' : 'No open jobs';
}
