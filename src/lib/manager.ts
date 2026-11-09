import type { ManagerGroupRow, ManagerPortfolio } from './reads';
import type { Language } from '../types/database';
import { formatNumber } from './format';

/**
 * The manager's view, as arithmetic.
 *
 * A manager does not dispatch, assign or complete; they compare. So the only
 * decisions worth testing here are the comparisons: which group is behind, how
 * much of the work in front of it is already late, and what the headline number
 * should be when the four groups under them are added together.
 */

/** The windows a manager actually asks about: a week, a month, a quarter. */
export const MANAGER_WINDOWS = [7, 30, 90] as const;
export type ManagerWindow = (typeof MANAGER_WINDOWS)[number];

export type PortfolioTone = 'good' | 'warn' | 'bad';

/**
 * How a group is doing, for the colour on its card.
 *
 * Overdue work outranks a blocker: a blocker is visible to the group and being
 * worked; a job that has been waiting past the promise is the failure the
 * department is measured on.
 */
export function groupTone(group: {
  waiting_over_sla: number;
  blocked: number;
  unassigned: number;
}): PortfolioTone {
  if (group.waiting_over_sla > 0) return 'bad';
  if (group.blocked > 0 || group.unassigned > 0) return 'warn';
  return 'good';
}

/** Share of open work that is already past the promise — 0 when nothing is open. */
export function overdueShare(group: { waiting_over_sla: number; active: number; unassigned: number }): number {
  const open = group.active + group.unassigned;
  if (open <= 0) return 0;
  return Math.min(1, group.waiting_over_sla / open);
}

/** `42%` — the number to put next to the group's name. */
export function overdueLabel(
  group: { waiting_over_sla: number; active: number; unassigned: number },
  lang: Language,
): string {
  if (group.waiting_over_sla <= 0) return lang === 'so' ? 'Waqtigeeda' : 'On time';
  return `${Math.round(overdueShare(group) * 100)}% ${lang === 'so' ? 'daahday' : 'late'}`;
}

/**
 * Groups that should be read first: overdue, then blocked, then plain volume.
 * Ties keep the group code order the server sent, so the list does not jump
 * around between two identical groups.
 */
export function rankGroups(groups: ManagerGroupRow[]): ManagerGroupRow[] {
  return [...groups].sort((a, b) => {
    if (b.waiting_over_sla !== a.waiting_over_sla) return b.waiting_over_sla - a.waiting_over_sla;
    if (b.blocked !== a.blocked) return b.blocked - a.blocked;
    if (b.active !== a.active) return b.active - a.active;
    return a.code.localeCompare(b.code);
  });
}

export interface PortfolioSummary {
  liveGroups: number;
  openJobs: number;
  overdue: number;
  blocked: number;
  completed: number;
  photos: number;
}

/**
 * The headline numbers, added up.
 *
 * Computed here rather than trusted from the server so that the same function
 * can check the two agree — `manager_portfolio` returns totals, and a screen
 * that silently showed a different sum from the cards beneath it would be worse
 * than no screen at all.
 */
export function summarisePortfolio(groups: ManagerGroupRow[]): PortfolioSummary {
  return groups.reduce<PortfolioSummary>(
    (sum, group) => ({
      liveGroups: sum.liveGroups + (group.is_active ? 1 : 0),
      openJobs: sum.openJobs + group.active + group.unassigned,
      overdue: sum.overdue + group.waiting_over_sla,
      blocked: sum.blocked + group.blocked,
      completed: sum.completed + group.completed,
      photos: sum.photos + group.photos,
    }),
    { liveGroups: 0, openJobs: 0, overdue: 0, blocked: 0, completed: 0, photos: 0 },
  );
}

/** Does the server's total match the rows it sent? Used as a honesty check. */
export function portfolioAgrees(portfolio: ManagerPortfolio): boolean {
  const local = summarisePortfolio(portfolio.groups ?? []);
  const remote = portfolio.totals;
  if (!remote) return false;
  return (
    local.overdue === remote.waiting_over_sla &&
    local.blocked === remote.blocked &&
    local.completed === remote.completed &&
    local.photos === remote.photos &&
    local.openJobs === remote.active + remote.unassigned
  );
}

/** `F2 — not started` for a group with no members, so a blank card is not a fault. */
export function groupCaption(group: ManagerGroupRow, lang: Language): string {
  if (!group.is_active) return lang === 'so' ? 'Aan firfircoonayn' : 'Not live yet';
  if (group.members === 0) return lang === 'so' ? 'Aan shaqaale lahayn' : 'No staff yet';
  return lang === 'so'
    ? `${formatNumber(group.members)} qof · ${formatNumber(group.technicians)} farsamayaqaan`
    : `${formatNumber(group.members)} people · ${formatNumber(group.technicians)} technicians`;
}

/** The window in words, for a heading. */
export function windowLabel(days: number, lang: Language): string {
  if (lang === 'so') return `${formatNumber(days)} maalmood`;
  return days === 1 ? '1 day' : `${formatNumber(days)} days`;
}
