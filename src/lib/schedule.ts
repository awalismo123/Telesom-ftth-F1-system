/**
 * When a job is meant to be done.
 *
 * `tasks.scheduled_date` has existed since the first schema with a
 * `DEFAULT CURRENT_DATE`, and until now **nothing read it**: the importer wrote
 * today's date into every row and every screen ignored the column. So the only
 * possible schedule was "now", which is why the group's plan lived in a
 * supervisor's head.
 *
 * The department sheets have no planned-date column — only `DateIn` and
 * `DateOut` — so a date cannot be imported. It is set by the supervisor, or it
 * defaults to the day the job arrived. That is the honest description of where
 * the date comes from.
 *
 * ## Days are strings here, on purpose
 *
 * A date-only value like `2026-11-15` is a *calendar* day, not an instant.
 * `new Date('2026-11-15')` parses as UTC midnight, which is 03:00 the same day
 * in Hargeisa but 19:00 the *previous* day in a negative-offset zone — so any
 * comparison that goes through `Date` can be wrong by a day depending on where
 * the phone is. `YYYY-MM-DD` sorts lexicographically in date order, so this
 * module compares the strings and never constructs a Date from the value.
 *
 * Day *arithmetic* (for "in 3 days") goes through `Date.UTC`, which has no
 * daylight-saving transitions, then formats back to a key. That keeps it
 * calendar-correct everywhere.
 */

import { todayKey } from './format';

/** How far ahead a job may be scheduled. Long enough for a real plan, short
 *  enough that a mistyped year is caught instead of hiding a job until 2126. */
export const SCHEDULE_MAX_AHEAD_DAYS = 90;

/** A calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

export type ScheduleBucket = 'past' | 'today' | 'planned';

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The supervisor's today, in their own timezone. The header uses the same call,
 *  so the board and the counts above it cannot disagree about which day it is. */
export function todayLocal(now: Date = new Date()): DayKey {
  return todayKey(now);
}

/**
 * Whole days from `today` to `day`; negative is the past, `null` is unreadable.
 *
 * Both arguments are calendar days, so this is pure arithmetic — no timezone,
 * no daylight saving, no three-hour Hargeisa gap.
 */
export function dayOffset(day: DayKey | null | undefined, today: DayKey): number | null {
  if (!day || !DAY_PATTERN.test(day) || !DAY_PATTERN.test(today)) return null;

  const toUtc = (key: DayKey) => {
    const [, y, m, d] = DAY_PATTERN.exec(key)!;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  };

  return Math.round((toUtc(day) - toUtc(today)) / 86_400_000);
}

/** `today + n` calendar days, as a key. */
export function addDays(today: DayKey, days: number): DayKey {
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Which day a job belongs to.
 *
 * A job with no date, or an unreadable one, is treated as **today**. The
 * database column is `NOT NULL`, but rows built by tests and older payloads can
 * arrive without it, and "no date" must never mean "hide this job".
 */
export function scheduleBucket(day: DayKey | null | undefined, today: DayKey): ScheduleBucket {
  const offset = dayOffset(day, today);
  if (offset === null || offset === 0) return 'today';
  return offset > 0 ? 'planned' : 'past';
}

/** A future-dated job: not work for today. */
export function isPlanned(day: DayKey | null | undefined, today: DayKey): boolean {
  return scheduleBucket(day, today) === 'planned';
}

/**
 * Jobs that are not yet due, soonest first.
 *
 * The board shows these in their own lane rather than mixing them into today's
 * pool, because a job planned for Thursday is not something to send a crew to
 * on Tuesday.
 */
export function plannedJobs<T extends { scheduled_date?: DayKey | null }>(
  tasks: readonly T[],
  today: DayKey,
): T[] {
  return tasks
    .filter((task) => isPlanned(task.scheduled_date, today))
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
}

/** Jobs whose day has arrived — today's, and anything late. Everything the
 *  screens already did with an undated job keeps working, because an undated
 *  job lands here. */
export function dueJobs<T extends { scheduled_date?: DayKey | null }>(
  tasks: readonly T[],
  today: DayKey,
): T[] {
  return tasks.filter((task) => !isPlanned(task.scheduled_date, today));
}

/** `null` when the date is usable, otherwise the reason it is not. */
export type ScheduleProblem = 'unreadable' | 'too-far' | 'too-old';

const SCHEDULE_MAX_BEHIND_DAYS = 365;

/**
 * Why a date cannot be saved, or `null` if it can.
 *
 * A day in the past is allowed — work is often logged against a sheet that
 * arrived late, and forbidding it would push people to lie about the date.
 * Anything older than a year or further than the planning window is a typo.
 */
export function scheduleProblem(day: DayKey, today: DayKey): ScheduleProblem | null {
  const offset = dayOffset(day, today);
  if (offset === null) return 'unreadable';
  if (offset > SCHEDULE_MAX_AHEAD_DAYS) return 'too-far';
  if (offset < -SCHEDULE_MAX_BEHIND_DAYS) return 'too-old';
  return null;
}

export interface ScheduleCopy {
  en: string;
  so: string;
}

export const SCHEDULE_PROBLEM_COPY: Record<ScheduleProblem, ScheduleCopy> = {
  unreadable: { en: 'That is not a valid date.', so: 'Taasi ma aha taariikh sax ah.' },
  'too-far': {
    en: `Jobs can be planned at most ${SCHEDULE_MAX_AHEAD_DAYS} days ahead.`,
    so: `Shaqooyinka waxaa la qorsheyn karaa ugu badnaan ${SCHEDULE_MAX_AHEAD_DAYS} maalmood.`,
  },
  'too-old': {
    en: 'That date is more than a year ago.',
    so: 'Taariikhdaasi waa in ka badan sannad ka hor.',
  },
};

/**
 * How to describe a day to someone reading a list: `Today`, `Tomorrow`,
 * `in 3 days`, `2 days late`.
 *
 * Past days say how late they are, because "3 days late" is the thing a
 * supervisor acts on and the date alone is not.
 */
export function scheduleLabel(day: DayKey | null | undefined, today: DayKey, lang: 'en' | 'so'): string {
  const offset = dayOffset(day, today);
  if (offset === null) return lang === 'so' ? 'Maanta' : 'Today';

  if (offset === 0) return lang === 'so' ? 'Maanta' : 'Today';
  if (offset === 1) return lang === 'so' ? 'Berri' : 'Tomorrow';

  if (offset > 1) {
    return lang === 'so' ? `${offset} maalmood` : `in ${offset} days`;
  }

  const late = Math.abs(offset);
  if (late === 1) return lang === 'so' ? '1 maalin ka dib' : '1 day late';
  return lang === 'so' ? `${late} maalmood ka dib` : `${late} days late`;
}

/** `2026-11-15` → `15/11`; enough to disambiguate two planned days. */
export function shortDay(day: DayKey | null | undefined): string {
  if (!day || !DAY_PATTERN.test(day)) return '—';
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
