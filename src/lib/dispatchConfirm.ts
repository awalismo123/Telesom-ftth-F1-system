/**
 * The last thing you see before somebody's whole day moves.
 *
 * A supervisor selects twenty jobs, taps a name in a list, and every one of them
 * is reassigned. The tap is one thumb-width away from the wrong row, and until
 * now it committed silently: the audit log recorded it, but by then the crews
 * already had their phones.
 *
 * This is not a "are you sure?" box. It names **who**, **how many**, and **which
 * jobs** — because the useful question at that moment is not "sure?" but
 * "did I pick the right person, and the right twenty?".
 */

import { targetKey, type DispatchTarget } from './dispatch';
import type { Lang } from './jobSheet';

export interface ConfirmTask {
  id: string;
  line_number: string | null;
  priority?: string | null;
  status?: string | null;
}

/** How many line numbers are shown before the rest are counted. */
export const PREVIEW_LINES = 5;

/**
 * The jobs that are about to move, in the order they will be described.
 *
 * Urgent first: if a supervisor has accidentally swept up an urgent job that
 * belongs to another crew, that is the one worth noticing before confirming.
 */
export function previewTasks(tasks: readonly ConfirmTask[]): ConfirmTask[] {
  return [...tasks].sort(
    (a, b) =>
      Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
      String(a.line_number ?? '').localeCompare(String(b.line_number ?? '')),
  );
}

/**
 * The line numbers, capped — plus how many were not shown.
 *
 * A confirm dialogue that lists twenty numbers is one nobody reads, so it lists
 * five and states the remainder. It never lists *none*: "20 jobs" with no
 * evidence of which is exactly the box that gets dismissed on reflex.
 */
export function linePreview(
  tasks: readonly ConfirmTask[],
  max: number = PREVIEW_LINES,
): { shown: string[]; hidden: number } {
  const ordered = previewTasks(tasks);
  const usable = ordered
    .map((task) => (task.line_number ?? '').trim())
    .filter((line) => line !== '');

  const shown = usable.slice(0, Math.max(1, max));
  return { shown, hidden: Math.max(0, usable.length - shown.length) };
}

/** How many of the selection are urgent — worth saying out loud. */
export function urgentCount(tasks: readonly ConfirmTask[]): number {
  return tasks.filter((task) => task.priority === 'urgent').length;
}

/**
 * Jobs that already belong to somebody.
 *
 * Reassigning those takes work off one person and gives it to another, and the
 * first person is not told. That is worth naming in the confirm.
 */
export function alreadyAssignedCount(tasks: readonly ConfirmTask[]): number {
  return tasks.filter(
    (task) =>
      task.status === 'assigned' ||
      task.status === 'in_progress' ||
      task.status === 'blocked',
  ).length;
}

export interface ConfirmSummary {
  title: string;
  target: string;
  count: number;
  lines: string;
  hidden: number;
  warnings: string[];
  confirmLabel: string;
  cancelLabel: string;
}

export function confirmSummary(
  target: DispatchTarget,
  tasks: readonly ConfirmTask[],
  lang: Lang,
): ConfirmSummary {
  const so = lang === 'so';
  const count = tasks.length;
  const { shown, hidden } = linePreview(tasks);
  const urgent = urgentCount(tasks);
  const taken = alreadyAssignedCount(tasks);

  const warnings: string[] = [];

  if (urgent > 0) {
    warnings.push(
      so
        ? `${urgent} shaqo oo degdeg ah ayaa ku jira.`
        : `${urgent} of these ${urgent === 1 ? 'is' : 'are'} urgent.`,
    );
  }

  if (taken > 0) {
    warnings.push(
      so
        ? `${taken} shaqo hore ayaa loo qoondeeyay qof kale — lama ogeysiin doono.`
        : `${taken} already ${taken === 1 ? 'belongs' : 'belong'} to somebody else — they will not be told.`,
    );
  }

  return {
    title: so ? 'Xaqiiji qaybinta' : 'Confirm assignment',
    target: target.name,
    count,
    lines: shown.join(' · '),
    hidden,
    warnings,
    confirmLabel: so
      ? `${count} shaqo u qoondee ${target.name}`
      : `Assign ${count} ${count === 1 ? 'job' : 'jobs'} to ${target.name}`,
    cancelLabel: so ? 'Jooji' : 'Cancel',
  };
}

/** Shown under the confirm: nothing has happened yet. */
export const CONFIRM_NOTE = {
  en: 'Nothing has been assigned yet. This is the last step before the crews see it.',
  so: 'Weli waxba lama qoondeyn. Tani waa tallaabada ugu dambaysa ka hor inta shaqaalaha aysan arkin.',
} as const;

/**
 * A stable identity for the pending action.
 *
 * Used as a React key so a re-render with a different selection cannot silently
 * reuse the previous target — the confirm must always describe what it will do.
 */
export function pendingKey(target: DispatchTarget, taskIds: readonly string[]): string {
  return `${targetKey(target)}|${[...taskIds].sort().join(',')}`;
}
