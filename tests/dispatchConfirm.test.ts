import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONFIRM_NOTE,
  PREVIEW_LINES,
  alreadyAssignedCount,
  confirmSummary,
  linePreview,
  pendingKey,
  previewTasks,
  urgentCount,
  type ConfirmTask,
} from '../src/lib/dispatchConfirm';
import type { DispatchTarget } from '../src/lib/dispatch';

/**
 * One tap in the picker used to reassign twenty jobs with no confirmation, and
 * the crews found out by phone. These tests pin the confirm: it names the
 * target, the count and the jobs — and cancelling does nothing at all.
 */

const target: DispatchTarget = {
  kind: 'crew',
  id: 'c1',
  name: 'F1 - Crew A',
  subtitle: 'Mustafe · Xasan',
  zoneFocus: 'JIGJIGAYAR',
  openJobs: 4,
  urgentJobs: 1,
  activeJobs: 0,
} as DispatchTarget;

const task = (over: Partial<ConfirmTask> = {}): ConfirmTask => ({
  id: 't1',
  line_number: '575373',
  priority: 'normal',
  status: 'unassigned',
  ...over,
});

/* -------------------------------------------------------------------------- */
/* It names what will happen                                                  */
/* -------------------------------------------------------------------------- */

test('the confirm names the target', () => {
  assert.match(confirmSummary(target, [task()], 'en').confirmLabel, /F1 - Crew A/);
});

test('the confirm names the count', () => {
  const s = confirmSummary(target, [task(), task({ id: 't2', line_number: '2' })], 'en');
  assert.equal(s.count, 2);
  assert.match(s.confirmLabel, /^Assign 2 jobs/);
});

test('one job is singular', () => {
  assert.match(confirmSummary(target, [task()], 'en').confirmLabel, /^Assign 1 job /);
});

test('the confirm shows which line numbers are moving', () => {
  // "20 jobs" with no evidence of which is the box people dismiss on reflex.
  const s = confirmSummary(
    target,
    [task({ line_number: 'A1' }), task({ id: 't2', line_number: 'B2' })],
    'en',
  );
  assert.match(s.lines, /A1/);
  assert.match(s.lines, /B2/);
});

test('a long selection shows a few lines and states the remainder', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    task({ id: `t${i}`, line_number: `L${String(i).padStart(2, '0')}` }),
  );
  const { shown, hidden } = linePreview(many);
  assert.equal(shown.length, PREVIEW_LINES);
  assert.equal(hidden, 12 - PREVIEW_LINES);
});

test('the preview never shows zero lines when there are jobs', () => {
  for (const max of [0, -3, 1]) {
    const { shown } = linePreview([task(), task({ id: 't2' })], max);
    assert.ok(shown.length >= 1, `max=${max} showed nothing`);
  }
});

test('jobs with no line number are counted but not listed', () => {
  const { shown, hidden } = linePreview([
    task({ line_number: null }),
    task({ id: 't2', line_number: 'A1' }),
  ]);
  assert.deepEqual(shown, ['A1']);
  assert.equal(hidden, 0);
});

/* -------------------------------------------------------------------------- */
/* It warns about the things that matter                                      */
/* -------------------------------------------------------------------------- */

test('urgent jobs in the selection are called out first', () => {
  const s = confirmSummary(target, [task(), task({ id: 't2', priority: 'urgent' })], 'en');
  assert.equal(urgentCount([task(), task({ id: 't2', priority: 'urgent' })]), 1);
  assert.ok(s.warnings.some((w) => /urgent/i.test(w)));
});

test('urgent jobs already preview first', () => {
  const rows = previewTasks([
    task({ id: 'a', line_number: 'A', priority: 'normal' }),
    task({ id: 'b', line_number: 'B', priority: 'urgent' }),
  ]);
  assert.equal(rows[0].id, 'b');
});

test('taking work off another crew is called out', () => {
  // Reassigning an assigned job removes it from somebody without telling them.
  const s = confirmSummary(target, [task({ status: 'assigned' })], 'en');
  assert.equal(alreadyAssignedCount([task({ status: 'assigned' })]), 1);
  assert.ok(s.warnings.some((w) => /will not be told/i.test(w)));
});

test('an in-progress job counts as belonging to somebody', () => {
  assert.equal(alreadyAssignedCount([task({ status: 'in_progress' })]), 1);
  assert.equal(alreadyAssignedCount([task({ status: 'unassigned' })]), 0);
});

test('a clean selection produces no warnings at all', () => {
  const s = confirmSummary(target, [task()], 'en');
  assert.deepEqual(s.warnings, []);
});

/* -------------------------------------------------------------------------- */
/* Cancelling does nothing                                                    */
/* -------------------------------------------------------------------------- */

test('the note says nothing has happened yet', () => {
  assert.match(CONFIRM_NOTE.en, /Nothing has been assigned yet/i);
  assert.match(CONFIRM_NOTE.so, /waxba lama qoondeyn/i);
});

test('the cancel label exists and is translated', () => {
  assert.equal(confirmSummary(target, [task()], 'en').cancelLabel, 'Cancel');
  assert.equal(confirmSummary(target, [task()], 'so').cancelLabel, 'Jooji');
});

test('the pending action is identified by target AND selection', () => {
  // So a re-render with a different selection cannot silently reuse the previous
  // target: the confirm must always describe what it will actually do.
  const a = pendingKey(target, ['t1', 't2']);
  const b = pendingKey(target, ['t2', 't1']);
  const c = pendingKey(target, ['t1']);
  assert.equal(a, b, 'order of selection must not change identity');
  assert.notEqual(a, c);
});

test('a different target is a different pending action', () => {
  const other = { ...target, id: 'c2' } as DispatchTarget;
  assert.notEqual(pendingKey(target, ['t1']), pendingKey(other, ['t1']));
});

test('the whole summary is translated', () => {
  const en = confirmSummary(target, [task()], 'en');
  const so = confirmSummary(target, [task()], 'so');
  assert.notEqual(en.title, so.title);
  assert.notEqual(en.confirmLabel, so.confirmLabel);
});

/* -------------------------------------------------------------------------- */
/* The board must actually use it                                             */
/* -------------------------------------------------------------------------- */

const board = readFileSync(
  fileURLToPath(new URL('../src/components/supervisor/dispatch/DispatchBoard.tsx', import.meta.url)),
  'utf8',
);

test('tapping a target no longer assigns immediately', () => {
  // The mis-tap this feature exists to prevent.
  assert.doesNotMatch(board, /onClick=\{\(\) => void runAssign\(target\)\}/);
});

test('the board asks for confirmation before assigning', () => {
  assert.match(board, /confirmSummary/);
  assert.match(board, /pendingTarget/);
});
