/**
 * Which equipment box keeps failing.
 *
 * Two things this module refuses to do, both learned from the live project:
 *
 * 1. **Use the lifetime `cableboxes.fault_count`.** It cannot answer "this
 *    month", and a box that failed forty times in 2024 but has been fine since
 *    would outrank one that failed five times last week. The window is computed
 *    from jobs at query time.
 *
 * 2. **Silently drop faults that name no box.** Measured on 15/11/2026: zero of
 *    eight tasks carried either a `cablebox_id` or a `cablebox_code_raw`. A
 *    leaderboard that discards unlinked work looks healthy and tells nobody that
 *    the import is losing the link. The count is surfaced as
 *    `unassigned_faults`.
 */

/** The windows a supervisor can choose. Kept short: a long list is a menu, not
 *  a decision, and every extra option is another number to quote out of context. */
export const FAULT_WINDOWS = [7, 30, 90] as const;
export type FaultWindow = (typeof FAULT_WINDOWS)[number];

export interface BoxFaultRow {
  box_id: string;
  box_code: string;
  xaafada: string | null;
  health_status: 'healthy' | 'warning' | 'critical' | null;
  faults: number;
  open_faults: number;
  last_fault_at: string | null;
}

export interface BoxFaultHistory {
  from: string;
  to: string;
  days: number;
  /** Always `'reported'`: the window applies to when the fault was reported. */
  basis: 'reported';
  boxes: BoxFaultRow[];
  /** Faults in the window that name no box we can match. */
  unassigned_faults: number;
}

/** The heading, shared with the tests so no screen can quote a count without
 *  its window. */
export function boxHistoryLabel(days: number, lang: 'en' | 'so'): string {
  return lang === 'so'
    ? `Ciladaha sanduuqa — ${days} maalmood`
    : `Box faults — last ${days} days`;
}

/** Said under the table, because a bare count invites a wrong conclusion. */
export const BOX_HISTORY_NOTE = {
  en: 'Counts faults reported in this window, including ones not fixed yet. A cancelled fault is not counted.',
  so: 'Waxay tirinaysaa ciladaha muddadan la soo sheegay, oo ay ku jiraan kuwa aan weli la hagaajin. Cilad la tirtiray lama tiriyo.',
} as const;

/**
 * Boxes with at least one fault, worst first.
 *
 * A box with zero faults is dropped from the *table* (it is noise) but stays in
 * the payload, so a screen that wants to show "2 boxes, no faults" still can.
 */
export function rankedBoxes(boxes: readonly BoxFaultRow[]): BoxFaultRow[] {
  return boxes
    .filter((box) => box.faults > 0)
    .sort((a, b) => b.faults - a.faults || a.box_code.localeCompare(b.box_code));
}

/** Total faults attributed to a named box in the window. */
export function attributedFaults(boxes: readonly BoxFaultRow[]): number {
  return boxes.reduce((sum, box) => sum + box.faults, 0);
}

/**
 * True when the numbers cannot be trusted as a full picture, because faults
 * exist that name no box.
 *
 * The screen must say so rather than presenting the leaderboard as complete.
 */
export function hasUnlinkedWork(history: Pick<BoxFaultHistory, 'unassigned_faults'>): boolean {
  return history.unassigned_faults > 0;
}
