/**
 * What has already happened on this line.
 *
 * A technician standing at a door is usually not the first person there. This is
 * the list behind that sentence: the dates, what kind of job it was, how it
 * ended, the dBm reading and who did it.
 *
 * ## Why a line and not a customer
 *
 * The sheet's key is `line_number`. Names are typed from a photograph of a
 * spreadsheet and drift between sheets — "Cabdi Xasan" on one, "Cabdi Xasan
 * Nuur" on the next — so grouping on a name quietly splits one customer into two
 * histories. The line is what the department works from and what the customer
 * reads off their own bill.
 *
 * ## Cancelled jobs are in the list
 *
 * A cancellation is part of what happened: somebody probably visited and found
 * nothing, or the customer withdrew the report. Leaving it out makes the history
 * shorter than the customer's memory of it. The status is shown so nobody has to
 * guess why.
 */

export interface HistoryJob {
  id: string;
  reported_date: string | null;
  sort_date: string | null;
  created_at: string;
  task_type: string;
  status: string;
  optical_dbm: number | null;
  xaafada: string | null;
  cablebox_code_raw: string | null;
  completion_notes: string | null;
  cancel_reason: string | null;
  technician: string | null;
  /** `null` when no job was excluded — the comparison is with a missing id. */
  is_current: boolean | null;
}

export interface LineHistory {
  line_number: string | null;
  found: boolean;
  jobs: HistoryJob[];
  total: number;
}

/* -------------------------------------------------------------------------- */
/* Reading the list                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The list as it should be read: newest first.
 *
 * The server already orders it, but the order is repeated here because the
 * meaning of the list depends on it — a history read oldest-first looks like a
 * story of decline when nothing of the sort happened. Sorting a copy also means
 * one bad row from the database cannot reorder the whole panel.
 *
 * Jobs with no `sort_date` fall to the end rather than to 1970.
 */
export function newestFirst(jobs: readonly HistoryJob[]): HistoryJob[] {
  return [...jobs].sort((a, b) => {
    const left = a.sort_date ?? '';
    const right = b.sort_date ?? '';
    if (left !== right) return right.localeCompare(left);
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

/** Real history only — the job being looked at is never part of its own past. */
export function previousJobs(
  history: LineHistory | null | undefined,
  currentTaskId: string,
): HistoryJob[] {
  if (!history) return [];
  return newestFirst(history.jobs.filter((job) => job.id !== currentTaskId));
}

/**
 * Whether there is anything to show.
 *
 * `found: false` and a line that is blank both mean "nothing", and the panel
 * needs to tell them apart in words: one says the line has no history, the other
 * says the job has no line to look up.
 */
export function hasHistory(jobs: readonly HistoryJob[]): boolean {
  return jobs.length > 0;
}

/** The most recent dBm on the line, which is what a technician compares against. */
export function lastDbm(jobs: readonly HistoryJob[]): number | null {
  for (const job of newestFirst(jobs)) {
    if (job.optical_dbm !== null && job.optical_dbm !== undefined) return job.optical_dbm;
  }
  return null;
}

/**
 * Has this line been failing with the same reading for a while?
 *
 * Two or more readings within 2 dB is a steady weak signal rather than a fresh
 * break — which points at the drop or the splitter, not at the customer's
 * equipment. Returns `null` when there is not enough evidence to say anything.
 */
export function steadySignal(jobs: readonly HistoryJob[]): { readings: number; spread: number } | null {
  const values = newestFirst(jobs)
    .map((job) => job.optical_dbm)
    .filter((value): value is number => value !== null && value !== undefined);
  if (values.length < 2) return null;
  const spread = Math.max(...values) - Math.min(...values);
  return spread <= 2 ? { readings: values.length, spread } : null;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

export function historyLabel(count: number, lang: 'en' | 'so'): string {
  if (lang === 'so') {
    return count === 1 ? '1 shaqo hore' : `${count} shaqo oo hore`;
  }
  return count === 1 ? '1 earlier job' : `${count} earlier jobs`;
}

/** Nothing on this line. Said plainly — an empty box reads as a loading failure. */
export function noHistoryCopy(lang: 'en' | 'so'): string {
  return lang === 'so'
    ? 'Shaqo hore oo lambarkan lagu sameeyay ma jirto.'
    : 'No earlier jobs recorded on this line.';
}

/** The job itself carries no line, so no history can be looked up. */
export function noLineCopy(lang: 'en' | 'so'): string {
  return lang === 'so'
    ? 'Shaqadan lambar line ma laha, marka taariikh lama raadin karo.'
    : 'This job has no line number, so no history can be looked up.';
}

export const HISTORY_NOTE = {
  en: 'Every job recorded against this line, including cancellations. Newest first.',
  so: 'Shaqo kasta oo lambarkan lagu diiwaangeliyay, oo ay ku jiraan kuwa la tirtiray. Midda ugu dambaysa hore.',
} as const;

/** Job type, in the language on screen. */
export function jobTypeLabel(taskType: string, lang: 'en' | 'so'): string {
  if (taskType === 'cilada') return lang === 'so' ? 'Cilad' : 'Fault';
  if (taskType === 'installation') return lang === 'so' ? 'Rakid' : 'Installation';
  return taskType;
}

/** The dBm reading, formatted the same way the rest of the app writes it. */
export function dbmLabel(value: number | null, lang: 'en' | 'so'): string {
  if (value === null || value === undefined) return lang === 'so' ? 'lama qorin' : 'not recorded';
  return `${value.toFixed(1)} dBm`;
}
