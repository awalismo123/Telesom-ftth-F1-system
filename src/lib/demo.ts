import type { Language } from '../types/database';

/**
 * How much of a number is demo, said out loud.
 *
 * Batch F built the demo history with a banner on the Insights screen and a
 * one-tap removal. The label stopped there. `period_report` and
 * `manager_portfolio` count demo rows like any other, so with the demo loaded
 * the printable report said "44 created, 39 completed" and the manager's
 * portfolio said 39, with nothing to say that 36 of those were synthetic.
 *
 * A report a head manager files is the one document that must not be quietly
 * fiction. The number is not the problem — the silence around it is.
 *
 * Kept as a pure sentence builder rather than inline JSX for two reasons: both
 * languages get written once and tested, and the wording can be asserted
 * without rendering a screen.
 */

export interface DemoSummary {
  /** Demo tasks in the scope and window. */
  tasks: number;
  /** All tasks in the same scope and window. */
  tasks_total: number;
  logs: number;
  logs_total: number;
  from: string | null;
  to: string | null;
}

/** True when demo rows are inflating the numbers on this screen. */
export function hasDemoData(summary: DemoSummary | null | undefined): boolean {
  return Boolean(summary && summary.tasks > 0);
}

/**
 * The sentence under a report heading.
 *
 * Returns `null` when there is nothing to say — no demo rows means no banner,
 * which is the state the app ships in.
 */
export function demoNotice(
  summary: DemoSummary | null | undefined,
  lang: Language,
): string | null {
  if (!hasDemoData(summary) || !summary) return null;

  const { tasks, tasks_total } = summary;

  if (lang === 'so') {
    // "36 ka mid ah 44 shaqo oo warbixintan ku jira waa tijaabo — ka saar
    // kahor inta aanad gudbin." Singular after a numeral is not used here:
    // Somali takes the plain noun after a counted number in this construction.
    return `${tasks} ka mid ah ${tasks_total} shaqo oo warbixintan ku jira waa tijaabo — ka saar ka hor inta aanad gudbin.`;
  }

  return `${tasks} of ${tasks_total} jobs in this report are demo — remove them before filing this.`;
}

/** Short label for a card or a chip, where the full sentence will not fit. */
export function demoChipLabel(summary: DemoSummary | null | undefined, lang: Language): string | null {
  if (!hasDemoData(summary) || !summary) return null;
  return lang === 'so' ? `${summary.tasks} tijaabo` : `${summary.tasks} demo`;
}

/**
 * The portfolio is a window, not a report, so the wording is about the window.
 */
export function portfolioDemoNotice(
  summary: DemoSummary | null | undefined,
  lang: Language,
): string | null {
  if (!hasDemoData(summary) || !summary) return null;

  const { tasks, tasks_total } = summary;

  if (lang === 'so') {
    return `${tasks} ka mid ah ${tasks_total} shaqo oo xilligan ku jira waa tijaabo. Tirooyinka kooxaha waxaa ku jira shaqo aan dhab ahayn.`;
  }

  return `${tasks} of ${tasks_total} jobs in this window are demo. The group figures below include synthetic work.`;
}
