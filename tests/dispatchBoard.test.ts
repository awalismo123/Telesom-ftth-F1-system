import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POOL_ORDER_NOTE,
  POOL_REASON_LABEL,
  areaGroups,
  boardState,
  hasRoute,
  orderPool,
  placeKey,
  poolReason,
  triagePool,
  triageSentence,
  unroutableJobs,
  unroutableNotice,
} from '../src/lib/dispatchBoard';
import { compareTasks } from '../src/lib/dispatch';
import type { Task } from '../src/types/database';

/**
 * The dispatch board is where work is actually moved, so the ordering is not
 * cosmetic: it is the sequence in which nineteen customers get served.
 *
 * These tests pin three things:
 *
 *  1. **One order, shared.** The board and the WhatsApp message must agree, or a
 *     supervisor ticks job 3 and the crew reads job 5.
 *  2. **Unroutable work is named.** Two urgent jobs with no area and no box are
 *     currently in the live pool. Auto-cluster would fold them into one
 *     "no area" batch and call it a route.
 *  3. **Blocked is not empty.** A board with jobs and no dispatchable people
 *     looks identical to a finished day unless the screen says otherwise.
 */

const TODAY = new Date('2026-11-24T09:00:00Z');

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    group_id: 'g1',
    line_number: '575373',
    customer_name: 'HOODO IDIRIS',
    customer_phone: '0634111111',
    xaafada: 'Jigjigayar',
    cablebox_code_raw: null,
    status: 'unassigned',
    priority: 'normal',
    task_type: 'cilada',
    reported_date: '2026-11-15',
    created_at: '2026-11-15T08:00:00Z',
    carryover_count: 0,
    scheduled_date: '2026-11-15',
    ...over,
  }) as Task;

/* -------------------------------------------------------------------------- */
/* Order                                                                      */
/* -------------------------------------------------------------------------- */

test('the board and the message use the same comparison', () => {
  // The message was already sorted with `compareTasks`; the board was not. Two
  // orderings of the same work is how a supervisor quotes a job the crew cannot
  // find.
  const jobs = [
    task({ id: 'a', line_number: 'B', reported_date: '2026-11-20' }),
    task({ id: 'b', line_number: 'A', reported_date: '2026-11-10' }),
    task({ id: 'c', line_number: 'C', priority: 'urgent' }),
  ];
  assert.deepEqual(
    orderPool(jobs).map((job) => job.id),
    [...jobs].sort(compareTasks).map((job) => job.id),
  );
});

test('urgent leads, then carried-over, then the oldest', () => {
  const rows = orderPool([
    task({ id: 'new', reported_date: '2026-11-24' }),
    task({ id: 'old', reported_date: '2026-11-01' }),
    task({ id: 'carried', reported_date: '2026-11-20', carryover_count: 2 }),
    task({ id: 'urgent', reported_date: '2026-11-23', priority: 'urgent' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['urgent', 'carried', 'old', 'new'],
  );
});

test('ordering does not mutate the list it was given', () => {
  // The board sorts a slice of state; mutating it would reorder every other
  // memo that holds the same array.
  const jobs = [task({ id: 'b', line_number: 'Z' }), task({ id: 'a', line_number: 'A' })];
  const before = jobs.map((job) => job.id);
  orderPool(jobs);
  assert.deepEqual(
    jobs.map((job) => job.id),
    before,
  );
});

test('the order is stable for identical jobs', () => {
  // Two supervisors looking at the same board must see the same list, and a row
  // that moves while being read is a row that gets tapped by accident.
  const jobs = Array.from({ length: 5 }, (_, i) =>
    task({ id: `t${i}`, line_number: `L${i}`, reported_date: '2026-11-15' }),
  );
  const first = orderPool(jobs).map((job) => job.id);
  const second = orderPool([...jobs].reverse()).map((job) => job.id);
  assert.deepEqual(first, second);
});

/* -------------------------------------------------------------------------- */
/* Reasons                                                                    */
/* -------------------------------------------------------------------------- */

test('urgent outranks every other reason for being at the top', () => {
  assert.equal(poolReason(task({ priority: 'urgent' }), TODAY), 'urgent');
  assert.equal(poolReason(task({ priority: 'urgent', carryover_count: 3 }), TODAY), 'urgent');
});

test('a carried-over job is flagged even when it is not old', () => {
  assert.equal(poolReason(task({ reported_date: '2026-11-24', carryover_count: 1 }), TODAY), 'carried');
});

test('the age bands match the rest of the app', () => {
  // SLA_DAYS is 3 everywhere; the pool must not invent a fourth opinion.
  assert.equal(poolReason(task({ reported_date: '2026-11-21' }), TODAY), 'due');
  assert.equal(poolReason(task({ reported_date: '2026-11-20' }), TODAY), 'late');
  assert.equal(poolReason(task({ reported_date: '2026-11-23' }), TODAY), null);
});

test('a fresh ordinary job carries no badge at all', () => {
  // A badge on every card is noise; the point of a badge is that it is rare.
  assert.equal(poolReason(task({ reported_date: '2026-11-24' }), TODAY), null);
});

test('every reason is labelled in both languages', () => {
  for (const [reason, label] of Object.entries(POOL_REASON_LABEL)) {
    assert.ok(label.en.length > 0, reason);
    assert.ok(label.so.length > 0, reason);
    assert.notEqual(label.en, label.so, reason);
  }
});

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

test('triage counts each job once, by its strongest reason', () => {
  // An urgent job is urgent, not also "late": adding it to both totals would
  // make the sentence add up to more jobs than exist.
  const triage = triagePool(
    [
      task({ id: 'u1', priority: 'urgent', reported_date: '2026-11-01' }),
      task({ id: 'u2', priority: 'urgent', reported_date: '2026-11-01' }),
      task({ id: 'c1', carryover_count: 1, reported_date: '2026-11-01' }),
      task({ id: 'l1', reported_date: '2026-11-01' }),
      task({ id: 'd1', reported_date: '2026-11-21' }),
      task({ id: 'n1', reported_date: '2026-11-24' }),
    ],
    TODAY,
  );

  assert.equal(triage.total, 6);
  assert.equal(triage.urgent, 2);
  assert.equal(triage.carried, 1);
  assert.equal(triage.late, 1);
  assert.equal(triage.due, 1);
  const counted = triage.urgent + triage.carried + triage.late + triage.due;
  assert.ok(counted <= triage.total, 'the reasons must not exceed the jobs');
});

test('triage separates routable from unroutable work', () => {
  // The live pool has 19 jobs of which 18 cannot be routed — this is not a
  // hypothetical.
  const triage = triagePool([
    task({ id: 'a', cablebox_code_raw: 'CB190-229 (06)', xaafada: null }),
    task({ id: 'b', cablebox_code_raw: null, xaafada: 'KOODBUUR' }),
    task({ id: 'c', cablebox_code_raw: null, xaafada: null }),
  ]);
  assert.equal(triage.routable, 2);
  assert.equal(triage.unroutable, 1);
  assert.equal(triage.routable + triage.unroutable, triage.total);
});

test('an empty or whitespace-only field does not make a job routable', () => {
  assert.equal(hasRoute({ cablebox_code_raw: '   ', xaafada: null }), false);
  assert.equal(hasRoute({ cablebox_code_raw: null, xaafada: '' }), false);
  assert.equal(hasRoute({ cablebox_code_raw: null, xaafada: 'Jigjigayar' }), true);
});

test('the unroutable list is itself in dispatch order, and bounded by nothing', () => {
  const jobs = unroutableJobs([
    task({ id: 'old', xaafada: null, reported_date: '2026-11-01' }),
    task({ id: 'urgent', xaafada: null, priority: 'urgent', reported_date: '2026-11-20' }),
    task({ id: 'fine', xaafada: 'SHEEDAHA' }),
  ]);
  assert.deepEqual(
    jobs.map((job) => job.id),
    ['urgent', 'old'],
  );
});

/* -------------------------------------------------------------------------- */
/* Areas                                                                      */
/* -------------------------------------------------------------------------- */

test('the same neighbourhood spelled three ways is one group', () => {
  // The seeder produced exactly this spread: `Jigjigayar`, `JIGJIGAYAR` and
  // `Jigjigayar `. Counting raw strings would report three areas.
  assert.equal(placeKey('Jigjigayar'), placeKey('JIGJIGAYAR'));
  assert.equal(placeKey('Jigjigayar '), placeKey('  jigjigayar'));

  const groups = areaGroups([
    task({ id: 'a', xaafada: 'Jigjigayar' }),
    task({ id: 'b', xaafada: 'JIGJIGAYAR' }),
    task({ id: 'c', xaafada: 'Jigjigayar ' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
});

test('areas are ordered by urgency first, then volume', () => {
  const groups = areaGroups([
    task({ id: 'a1', xaafada: 'KOODBUUR' }),
    task({ id: 'a2', xaafada: 'KOODBUUR' }),
    task({ id: 'a3', xaafada: 'KOODBUUR' }),
    task({ id: 'b1', xaafada: 'SHEEDAHA', priority: 'urgent' }),
  ]);
  assert.equal(groups[0].label, 'SHEEDAHA');
  assert.equal(groups[0].urgent, 1);
});

test('jobs with no area are left out of the groups, not lumped into an empty one', () => {
  // They are the banner's job to report; a blank group would read as a place.
  const groups = areaGroups([task({ id: 'a', xaafada: null }), task({ id: 'b', xaafada: '   ' })]);
  assert.equal(groups.length, 0);
});

test('an area keeps the spelling it was written with', () => {
  const groups = areaGroups([task({ xaafada: ' Jigjigayar ' })]);
  assert.equal(groups[0].label, 'Jigjigayar');
  assert.equal(groups[0].key, 'JIGJIGAYAR');
});

/* -------------------------------------------------------------------------- */
/* Sentences                                                                  */
/* -------------------------------------------------------------------------- */

test('the pool sentence leads with what to do, not with what is biggest', () => {
  const text = triageSentence(
    triagePool(
      [
        task({ id: 'u1', priority: 'urgent' }),
        task({ id: 'n1' }),
        task({ id: 'n2' }),
        task({ id: 'n3' }),
        task({ id: 'n4' }),
      ],
      TODAY,
    ),
    'en',
  );
  assert.match(text, /urgent/i);
  assert.match(text, /go first/);
});

test('a clear pool says so instead of showing an empty frame', () => {
  assert.match(triageSentence(triagePool([], TODAY), 'en'), /pool is clear/i);
  assert.match(triageSentence(triagePool([], TODAY), 'so'), /madhan/);
});

test('the sentence is translated', () => {
  const triage = triagePool([task({ priority: 'urgent' }), task({ id: 'b' })], TODAY);
  assert.notEqual(triageSentence(triage, 'en'), triageSentence(triage, 'so'));
});

test('a pool where nothing can be routed leads with that, not with lateness', () => {
  // Being late is a symptom the supervisor understands; having no area or box
  // is the obstacle in front of them. Leading with "all 19 are past the
  // promise" names an action the board cannot offer.
  const triage = triagePool(
    [
      task({ id: 'a', xaafada: null, cablebox_code_raw: null }),
      task({ id: 'b', xaafada: null, cablebox_code_raw: null }),
    ],
    TODAY,
  );
  const text = triageSentence(triage, 'en');
  assert.match(text, /no route to plan/);
  assert.doesNotMatch(text, /promise/);
});

test('a partly unroutable pool still leads with urgency', () => {
  // The rest of the pool can still be dispatched, so lateness is the headline
  // and the banner underneath carries the caveat.
  const triage = triagePool(
    [
      task({ id: 'a', xaafada: null, cablebox_code_raw: null }),
      task({ id: 'b', xaafada: 'SHEEDAHA' }),
      task({ id: 'c', xaafada: 'SHEEDAHA' }),
    ],
    TODAY,
  );
  const text = triageSentence(triage, 'en');
  assert.match(text, /promise/);
  assert.doesNotMatch(text, /no route to plan/);
  assert.equal(triage.unroutable, 1);
});

test('an urgent unroutable pool still names the urgent jobs', () => {
  // The banner is what carries this, and it must not go quiet.
  const jobs = [
    task({ id: 'a', xaafada: null, cablebox_code_raw: null, priority: 'urgent' }),
    task({ id: 'b', xaafada: null, cablebox_code_raw: null }),
  ];
  const notice = unroutableNotice(jobs, 'en')!;
  assert.match(notice.body, /urgent/i);
});

test('the unroutable banner names the lines and says what to do', () => {
  const notice = unroutableNotice(
    [
      task({ id: 'a', line_number: '573864', xaafada: null, priority: 'urgent' }),
      task({ id: 'b', line_number: '588114', xaafada: null, priority: 'urgent' }),
    ],
    'en',
  )!;

  assert.match(notice.title, /2/);
  assert.match(notice.body, /573864/);
  assert.match(notice.body, /588114/);
  assert.match(notice.body, /urgent/i);
  assert.match(notice.body, /add the area or box/i);
});

test('the banner truncates a long list instead of printing nineteen lines', () => {
  const jobs = Array.from({ length: 19 }, (_, i) =>
    task({ id: `t${i}`, line_number: `L${i}`, xaafada: null }),
  );
  const notice = unroutableNotice(jobs, 'en')!;
  assert.match(notice.body, /13 more/);
});

test('no unroutable jobs means no banner at all', () => {
  assert.equal(unroutableNotice([], 'en'), null);
});

test('the order note explains itself in both languages', () => {
  assert.match(POOL_ORDER_NOTE.en, /urgent first/i);
  assert.match(POOL_ORDER_NOTE.en, /same order/i);
  assert.match(POOL_ORDER_NOTE.so, /Degdegga hore/);
});

/* -------------------------------------------------------------------------- */
/* Board state                                                                */
/* -------------------------------------------------------------------------- */

test('a blocked board is not an empty one', () => {
  // A board with jobs and no dispatchable people looks identical to a finished
  // day unless the screen distinguishes them.
  assert.equal(boardState(19, 0), 'no-targets');
  assert.equal(boardState(0, 2), 'no-jobs');
  assert.equal(boardState(0, 0), 'no-jobs-no-targets');
  assert.equal(boardState(19, 2), 'ready');
});
