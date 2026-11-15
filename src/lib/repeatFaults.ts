/**
 * A customer who keeps coming back.
 *
 * ## The rule
 *
 * A line is escalated at **three non-cancelled fault jobs within the window**
 * (90 days by default). That is the department's own rule.
 *
 * ## What this is NOT
 *
 * **Never "the same phone number appeared twice".** Two customers share a phone
 * — a shop, a family, a borrowed handset — and a rule built on phone numbers
 * would accuse an innocent household every time. Identity is `line_number`,
 * because that is what the sheet keys on and what the customer recognises on
 * their own bill.
 *
 * ## Why the count is not of "repeat" flags
 *
 * `is_repeat_fault` is set by the importer only when a line comes back after a
 * **completed** job, so the first fault on a line is never flagged. Three real
 * faults would produce two flags, and the escalation would need a fourth fault
 * to fire. Worse, it depends on timing: if the earlier job is still open when
 * the next sheet is imported, the newer row is a carryover and never flagged at
 * all.
 *
 * So the count is of the faults themselves. `flagged_repeats` is carried
 * alongside as supporting evidence and is never the trigger.
 */

/** The escalation window, in days. Matches the department's "three in ninety". */
export const REPEAT_WINDOW_DAYS = 90;

/** How many faults make a line worth investigating. */
export const REPEAT_THRESHOLD = 3;

export interface RepeatLine {
  line_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  xaafada: string | null;
  cablebox_code: string | null;
  faults: number;
  open_faults: number;
  last_fault_at: string | null;
  /** How many of those faults carry the importer's "came back after a fix" flag.
   *  Evidence, not the trigger — it is usually lower than `faults`. */
  flagged_repeats: number;
}

export interface RepeatWatch {
  from: string;
  to: string;
  days: number;
  threshold: number;
  basis: 'reported';
  lines: RepeatLine[];
  total_flagged: number;
}

export interface RepeatCountJob {
  id: string;
  reported_date: string | null;
  status: string;
  is_repeat_fault: boolean;
}

export interface RepeatCount {
  line_number: string | null;
  faults: number;
  threshold: number;
  days: number;
  from: string;
  to: string;
  /** True at or above the threshold — this is what the screens act on. */
  investigate: boolean;
  /** False when the job carries no line number, so no claim can be made. */
  known: boolean;
  jobs: RepeatCountJob[];
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The heading. Always carries the window — "3 faults" means nothing without it. */
export function repeatWatchLabel(days: number, lang: 'en' | 'so'): string {
  return lang === 'so' ? `Cilado soo noqnoqda — ${days} maalmood` : `Repeat faults — last ${days} days`;
}

/**
 * The one sentence that keeps this honest.
 *
 * "Repeat" is a strong word to put in front of a supervisor. It must say what it
 * counted and what it did not, or it will be read as "this customer is
 * difficult".
 */
export const REPEAT_NOTE = {
  en: 'Counts fault jobs reported in this window. A cancelled fault is not counted, and the same phone number is never treated as the same customer.',
  so: 'Waxay tirinaysaa ciladaha muddadan la soo sheegay. Cilad la tirtiray lama tiriyo, lambarka taleefanka isku mid ahna looma qaato macmiil isku mid ah.',
} as const;

/** On a job sheet, when the line has crossed the threshold. */
export function investigateCopy(faults: number, days: number, lang: 'en' | 'so'): string {
  return lang === 'so'
    ? `${faults} ciladood ${days} maalmood gudahood — baaritaan ayaa loo baahan yahay`
    : `${faults} faults in ${days} days — worth investigating`;
}

/** On a job sheet, when it has not. Shown quietly, or not at all. */
export function faultHistoryCopy(faults: number, days: number, lang: 'en' | 'so'): string {
  if (lang === 'so') {
    return faults === 1
      ? `1 cilad ${days} maalmood gudahood`
      : `${faults} ciladood ${days} maalmood gudahood`;
  }
  return faults === 1 ? `1 fault in ${days} days` : `${faults} faults in ${days} days`;
}

/* -------------------------------------------------------------------------- */
/* Reading the results                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Does this job's customer deserve a second look?
 *
 * `known: false` means the job has no line number. It must never be escalated —
 * an unattributable job is not evidence about anybody.
 */
export function needsInvestigation(count: RepeatCount | null | undefined): boolean {
  if (!count || !count.known) return false;
  return count.faults >= count.threshold;
}

/** Worst first: most faults, then most recent. A stable order matters because
 *  the same list is quoted in a meeting. */
export function rankedRepeatLines(lines: readonly RepeatLine[]): RepeatLine[] {
  return [...lines].sort(
    (a, b) =>
      b.faults - a.faults ||
      String(b.last_fault_at ?? '').localeCompare(String(a.last_fault_at ?? '')) ||
      a.line_number.localeCompare(b.line_number),
  );
}

/**
 * How to describe the supporting evidence without implying it is the reason.
 *
 * Returns `null` when there is nothing to say, so the screen does not print
 * "0 of these were flagged as returns" — which reads like a contradiction.
 */
export function evidenceLine(line: RepeatLine, lang: 'en' | 'so'): string | null {
  if (line.flagged_repeats <= 0) return null;
  const of = `${line.flagged_repeats}/${line.faults}`;
  return lang === 'so'
    ? `${of} waxay ahaayeen kuwo hore loo calaamadeeyay`
    : `${of} of these were already flagged as returns`;
}
