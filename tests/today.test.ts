/**
 * The supervisor's landing sentence.
 *
 * The screen it replaced said "Phase 1 Live" five times. What replaced it has
 * to answer one question — what needs me now — and the order of that answer is
 * a decision, not a formatting detail: a blocked job is somebody standing still
 * waiting for a decision, an overdue job is a customer the department has
 * already failed, an unassigned job is a queue that can still be beaten.
 *
 * Saying all three at once says nothing, so exactly one sentence is shown and
 * the priority is pinned here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headlineTone,
  jobCount,
  todayHeadline,
  todayItems,
  type TodaySummary,
} from '../src/lib/today';
import { OPEN_TASK_CAP, showingLabel, truncatedNotice } from '../src/lib/lists';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const day = (over: Partial<TodaySummary> = {}): TodaySummary => ({
  day: '2026-11-12',
  open_now: 0,
  unassigned: 0,
  assigned: 0,
  in_progress: 0,
  blocked: 0,
  over_sla: 0,
  created_today: 0,
  completed_today: 0,
  crews_out: 0,
  crews_total: 2,
  people_out: 0,
  ...over,
});

test('blocked outranks everything, because someone is waiting', () => {
  const summary = day({ blocked: 2, over_sla: 9, unassigned: 5, open_now: 16 });
  assert.match(todayHeadline(summary, 'en'), /blocked/i);
  assert.match(todayHeadline(summary, 'so'), /xanniban/i);
  assert.equal(headlineTone(summary), 'urgent');
});

test('overdue outranks unassigned', () => {
  const summary = day({ over_sla: 3, unassigned: 8, open_now: 11 });
  assert.match(todayHeadline(summary, 'en'), /past the 3-day promise/i);
  assert.match(todayHeadline(summary, 'so'), /ballanta 3 maalmood/i);
  assert.equal(headlineTone(summary), 'urgent');
});

test('unassigned is attention, not urgency', () => {
  const summary = day({ unassigned: 4, open_now: 4 });
  assert.match(todayHeadline(summary, 'en'), /unassigned/i);
  assert.equal(headlineTone(summary), 'attention');
});

test('a clear day says so, and counts the crews out', () => {
  const quiet = day({ open_now: 2, crews_out: 1 });
  assert.equal(headlineTone(quiet), 'calm');
  assert.match(todayHeadline(quiet, 'en'), /none past the promise/i);

  const empty = day({ open_now: 0, crews_out: 1 });
  assert.match(todayHeadline(empty, 'en'), /No open jobs\. 1 crew is out/i);

  const nothing = day();
  assert.match(todayHeadline(nothing, 'en'), /Nobody is out/i);
});

test('the two languages never produce the same sentence', () => {
  for (const summary of [
    day({ blocked: 1 }),
    day({ over_sla: 1 }),
    day({ unassigned: 1 }),
    day({ open_now: 3 }),
    day(),
  ]) {
    assert.notEqual(
      todayHeadline(summary, 'en'),
      todayHeadline(summary, 'so'),
      'a sentence was left in one language',
    );
  }
});

test('grammar holds at one and at many', () => {
  assert.match(todayHeadline(day({ blocked: 1 }), 'en'), /^1 job is blocked/);
  assert.match(todayHeadline(day({ blocked: 2 }), 'en'), /^2 jobs are blocked/);
  // Somali takes the plain noun after a numeral — no plural suffix.
  assert.match(todayHeadline(day({ blocked: 2 }), 'so'), /^2 shaqo/);
  assert.match(jobCount(1, 'en'), /1 job$/);
  assert.match(jobCount(7, 'en'), /7 jobs$/);
});

test('every tile carries a number and a sentence', () => {
  const items = todayItems(day({ blocked: 2, over_sla: 1, unassigned: 3, crews_out: 1, people_out: 2, in_progress: 1, completed_today: 4 }), 'en');

  assert.equal(items.length, 5);
  for (const item of items) {
    assert.ok(item.label.length > 0, `${item.id} has no label`);
    assert.ok(item.hint.length > 0, `${item.id} has no hint`);
  }

  const crews = items.find((item) => item.id === 'out');
  assert.equal(crews?.value, '1/2');
});

test('a tile only offers a tap when there is somewhere useful to go', () => {
  const quiet = todayItems(day({ crews_total: 2 }), 'en');
  assert.equal(quiet.find((item) => item.id === 'blocked')?.tab, null);
  assert.equal(quiet.find((item) => item.id === 'overdue')?.tab, null);
  assert.equal(quiet.find((item) => item.id === 'closed')?.tab, null);

  const busy = todayItems(day({ blocked: 1 }), 'en');
  assert.equal(busy.find((item) => item.id === 'blocked')?.tab, 'dispatch');
});

/* -------------------------------------------------------------------------- */
/* Lists that stop short                                                       */
/* -------------------------------------------------------------------------- */

test('a truncated list says so, and a complete one says nothing', () => {
  assert.equal(truncatedNotice(OPEN_TASK_CAP - 1, OPEN_TASK_CAP, 'en'), null);
  assert.match(truncatedNotice(OPEN_TASK_CAP, OPEN_TASK_CAP, 'en') ?? '', /stops at 600/);
  assert.match(truncatedNotice(OPEN_TASK_CAP, OPEN_TASK_CAP, 'so') ?? '', /600 shaqo oo keliya/);
});

test('showing X of Y appears only when something is hidden', () => {
  assert.equal(showingLabel(42, 42, 'en'), null);
  assert.equal(showingLabel(42, 118, 'en'), 'Showing 42 of 118');
  assert.equal(showingLabel(42, 118, 'so'), '42 ka mid ah 118 ayaa la muujiyay');
});

test('the cap the board warns about is the cap the database enforces', () => {
  // Two numbers in two languages: `OPEN_TASK_CAP` in TypeScript, `LIMIT 600`
  // in `list_open_tasks`. If SQL lowers the cap and this constant does not
  // follow, the board silently stops warning — the exact failure it exists to
  // prevent. Pinned together here.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/011_batch_b_access_control.sql', import.meta.url)),
    'utf8',
  );

  const fn = sql.slice(sql.indexOf('FUNCTION public.list_open_tasks'));
  const limit = fn.slice(0, fn.indexOf('$fn$')).match(/LIMIT\s+(\d+)/i)?.[1];

  assert.ok(limit, 'could not find the LIMIT in list_open_tasks — has the function moved?');
  assert.equal(
    Number(limit),
    OPEN_TASK_CAP,
    'the board warns about a different cap than the database applies',
  );
});
