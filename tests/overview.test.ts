import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERVIEW_NOTE,
  WORK_NOTE,
  ageTone,
  attentionItems,
  attentionTotal,
  daysWaiting,
  greeting,
  idleRows,
  lastActivityDay,
  loadRows,
  loadSummary,
  movementSeries,
  movementSummary,
  queueRemainder,
  recentEvents,
  seriesPeak,
  strandedRows,
  updatedLabel,
  workQueue,
  type AttentionInput,
} from '../src/lib/overview';
import {
  OVERVIEW_SOURCE_COUNT,
  nothingLoaded,
  partLabel,
  partialNotice,
} from '../src/lib/overviewService';
import type { Task } from '../src/types/database';
import type { ActivityEvent } from '../src/lib/activity';
import type { LoadCrew, LoadUser } from '../src/lib/dispatchService';
import { SLA_DAYS } from '../src/lib/activity';

/**
 * The command page is where a supervisor decides what the day is about. The
 * things worth pinning here are decisions, not formatting:
 *
 *  * the queue is attacked in one defined order;
 *  * nobody is ranked;
 *  * a job with an unknown age is never treated as new;
 *  * a crew with nobody in it is shown and flagged, not hidden.
 */

const TODAY = '2026-11-15';

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    group_id: 'g1',
    line_number: '575373',
    customer_name: 'HOODO IDIRIS',
    customer_phone: '0634111111',
    xaafada: 'JIGJIGAYAR',
    status: 'unassigned',
    priority: 'normal',
    task_type: 'cilada',
    reported_date: '2026-11-15',
    created_at: '2026-11-15T08:00:00Z',
    ...over,
  }) as Task;

const event = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  at: '2026-11-15T08:00:00Z',
  kind: 'completed',
  subject: 'job',
  task_id: 't1',
  line_number: '1',
  customer_name: 'X',
  actor: 'Mustafe',
  seconds: null,
  dbm: null,
  reason: null,
  notes: null,
  channel: null,
  task_count: null,
  ...over,
});

const user = (over: Partial<LoadUser> = {}): LoadUser => ({
  id: 'u1',
  full_name: 'Cabdiraxmaan Maxamed',
  username: 'cabdi',
  phone: '0634111111',
  open_jobs: 0,
  active_jobs: 0,
  done_today: 0,
  urgent_jobs: 0,
  ...over,
});

const crew = (over: Partial<LoadCrew> = {}): LoadCrew => ({
  id: 'c1',
  name: 'F1 - Crew A',
  vehicle_tag: 'A-123',
  zone_focus: 'JIGJIGAYAR',
  members: [{ id: 'm1', full_name: 'Mustafe' }],
  open_jobs: 0,
  active_jobs: 0,
  done_today: 0,
  urgent_jobs: 0,
  ...over,
});

const attention = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  blocked: 0,
  over_sla: 0,
  due_today: 0,
  unassigned: 0,
  urgent_open: 0,
  ...over,
});

/* -------------------------------------------------------------------------- */
/* Attention rail                                                             */
/* -------------------------------------------------------------------------- */

test('the rail shows the five things that need a decision, in order', () => {
  const items = attentionItems(attention({ blocked: 2 }), 'en');
  assert.deepEqual(
    items.map((item) => item.id),
    ['blocked', 'overdue', 'due', 'unassigned', 'urgent'],
  );
});

test('blocked leads the rail because somebody is standing still', () => {
  const items = attentionItems(attention({ blocked: 1, over_sla: 9 }), 'en');
  assert.equal(items[0].id, 'blocked');
  assert.equal(items[0].tone, 'urgent');
});

test('a zero is calm and carries no navigation', () => {
  // A tile that invites a tap and then opens an empty board is worse than a
  // tile that says nothing is wrong.
  const items = attentionItems(attention(), 'en');
  for (const item of items) {
    assert.equal(item.value, 0);
    assert.equal(item.tone, 'calm');
    assert.equal(item.tab, null, `${item.id} should not navigate when zero`);
  }
});

test('a non-zero count is tappable and toned', () => {
  const items = attentionItems(attention({ unassigned: 19, over_sla: 19 }), 'en');
  const unassigned = items.find((item) => item.id === 'unassigned')!;
  assert.equal(unassigned.tab, 'dispatch');
  assert.equal(unassigned.tone, 'attention');

  const overdue = items.find((item) => item.id === 'overdue')!;
  assert.equal(overdue.tone, 'urgent');
});

test('due today is attention, not urgent — it is the one group still saveable', () => {
  const due = attentionItems(attention({ due_today: 3 }), 'en').find((item) => item.id === 'due')!;
  assert.equal(due.tone, 'attention');
  assert.match(due.hint, /promise holds/i);
});

test('the overdue label carries the SLA window', () => {
  const overdue = attentionItems(attention(), 'en').find((item) => item.id === 'overdue')!;
  assert.match(overdue.label, new RegExp(String(SLA_DAYS)));
});

test('the rail is translated', () => {
  const en = attentionItems(attention({ blocked: 1 }), 'en');
  const so = attentionItems(attention({ blocked: 1 }), 'so');
  assert.notEqual(en[0].label, so[0].label);
  assert.notEqual(en[0].hint, so[0].hint);
});

test('the attention total sums problems, not jobs', () => {
  assert.equal(attentionTotal(attention({ blocked: 1, over_sla: 2, unassigned: 3 })), 6);
});

/* -------------------------------------------------------------------------- */
/* Age                                                                        */
/* -------------------------------------------------------------------------- */

test('days waiting are counted from the report date', () => {
  assert.equal(daysWaiting(task({ reported_date: '2026-11-15' }), TODAY), 0);
  assert.equal(daysWaiting(task({ reported_date: '2026-11-12' }), TODAY), 3);
  assert.equal(daysWaiting(task({ reported_date: '2026-11-01' }), TODAY), 14);
});

test('a missing report date falls back to when we read the sheet', () => {
  // Can be a day later than the report, which is why the report date is preferred.
  assert.equal(
    daysWaiting(task({ reported_date: null, created_at: '2026-11-10T22:00:00Z' }), TODAY),
    5,
  );
});

test('a job with no usable date has unknown age, not age zero', () => {
  // Zero would hide it at the bottom of a list sorted by age.
  assert.equal(daysWaiting(task({ reported_date: null, created_at: null }), TODAY), null);
});

test('a future-dated job is zero days, never negative', () => {
  assert.equal(daysWaiting(task({ reported_date: '2026-12-01' }), TODAY), 0);
});

test('the age badge follows the same three-day boundary as everywhere else', () => {
  assert.equal(ageTone(2, 'normal'), 'normal');
  assert.equal(ageTone(3, 'normal'), 'due');
  assert.equal(ageTone(4, 'normal'), 'late');
  assert.equal(ageTone(null, 'normal'), 'normal');
});

test('urgent outranks the clock on the badge', () => {
  // It is a decision already made about this job, and a supervisor scanning a
  // list needs to see it before they see arithmetic.
  assert.equal(ageTone(10, 'urgent'), 'urgent');
  assert.equal(ageTone(0, 'urgent'), 'urgent');
});

/* -------------------------------------------------------------------------- */
/* The work queue                                                             */
/* -------------------------------------------------------------------------- */

test('the queue puts urgent first, then the oldest', () => {
  const rows = workQueue(
    [
      task({ id: 'new', line_number: 'A', reported_date: '2026-11-15' }),
      task({ id: 'old', line_number: 'B', reported_date: '2026-11-01' }),
      task({ id: 'urgent', line_number: 'C', reported_date: '2026-11-14', priority: 'urgent' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['urgent', 'old', 'new'],
  );
});

test('the queue never contains finished or cancelled work', () => {
  const rows = workQueue(
    [
      task({ id: 'done', status: 'completed' }),
      task({ id: 'gone', status: 'cancelled' }),
      task({ id: 'live', status: 'assigned' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['live'],
  );
});

test('a job with unknown age sorts after dated jobs, not above them', () => {
  // Treating unknown as "newest" would push a genuinely old job off the list.
  const rows = workQueue(
    [
      task({ id: 'unknown', line_number: 'A', reported_date: null, created_at: null }),
      task({ id: 'old', line_number: 'B', reported_date: '2026-11-01' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['old', 'unknown'],
  );
});

test('equal ages break the tie by line number, so the order never jumps', () => {
  const rows = workQueue(
    [
      task({ id: 'z', line_number: 'Z9', reported_date: '2026-11-10' }),
      task({ id: 'a', line_number: 'A1', reported_date: '2026-11-10' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a', 'z'],
  );
});

test('the queue respects its limit and reports it', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    task({ id: `t${i}`, line_number: `L${String(i).padStart(2, '0')}` }),
  );
  const rows = workQueue(many, TODAY, 8);
  assert.equal(rows.length, 8);
  assert.equal(queueRemainder(12, rows.length), 4);
  assert.equal(queueRemainder(3, 8), 0);
});

test('the queue preserves what a supervisor needs to phone somebody', () => {
  const [row] = workQueue([task()], TODAY);
  assert.equal(row.customer_phone, '0634111111');
  assert.equal(row.line_number, '575373');
  assert.equal(row.xaafada, 'JIGJIGAYAR');
});

/* -------------------------------------------------------------------------- */
/* Load board                                                                 */
/* -------------------------------------------------------------------------- */

test('crews and unaccompanied people are both listed', () => {
  const rows = loadRows({ users: [user()], crews: [crew()] });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.kind).sort(),
    ['crew', 'person'],
  );
});

test('a technician inside a crew is not listed twice', () => {
  // Their numbers would otherwise be split across two rows, which reads as half
  // a technician in each place.
  const rows = loadRows({
    users: [user({ id: 'm1', full_name: 'Mustafe' }), user({ id: 'u9', full_name: 'Xasan' })],
    crews: [crew({ members: [{ id: 'm1', full_name: 'Mustafe' }] })],
  });
  assert.deepEqual(
    rows.map((row) => row.name),
    ['F1 - Crew A', 'Xasan'],
  );
});

test('the board is alphabetical, never by workload', () => {
  // A list ordered by open jobs is a leaderboard under another name.
  const rows = loadRows({
    users: [
      user({ id: 'u1', full_name: 'Zaki', open_jobs: 0 }),
      user({ id: 'u2', full_name: 'Amina', open_jobs: 99 }),
    ],
    crews: [],
  });
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Amina', 'Zaki'],
  );
});

test('a crew with nobody in it is shown and flagged, not hidden', () => {
  const rows = loadRows({ users: [], crews: [crew({ members: [] })] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stranded, true);
  assert.deepEqual(strandedRows(rows).map((row) => row.name), ['F1 - Crew A']);
});

test('a stranded crew is never counted as available', () => {
  const rows = loadRows({
    users: [],
    crews: [crew({ id: 'c1', name: 'A', members: [] }), crew({ id: 'c2', name: 'B', members: [{ id: 'm2', full_name: 'X' }] })],
  });
  assert.deepEqual(idleRows(rows).map((row) => row.name), ['B']);
});

test('the load summary explains stranded crews instead of just counting them', () => {
  // "0 of 2 available" with no explanation looks like a quiet afternoon rather
  // than a roster fault.
  const rows = loadRows({ users: [], crews: [crew({ members: [] })] });
  const text = loadSummary(rows, 'en');
  assert.match(text, /no members/);
  assert.match(text, /0 of 0/);
});

test('the load summary is translated', () => {
  const rows = loadRows({ users: [user()], crews: [] });
  assert.notEqual(loadSummary(rows, 'en'), loadSummary(rows, 'so'));
});

/* -------------------------------------------------------------------------- */
/* Movement                                                                   */
/* -------------------------------------------------------------------------- */

test('the week has one point per day, including empty days', () => {
  // A sparkline that skips empty days compresses a quiet week into a busy line.
  const series = movementSeries([], TODAY, 7);
  assert.equal(series.length, 7);
  assert.equal(series[6].date, TODAY);
  assert.ok(series.every((point) => point.arrived === 0 && point.closed === 0));
});

test('arrivals and completions land on the right day', () => {
  const series = movementSeries(
    [
      event({ at: '2026-11-15T09:00:00Z', kind: 'completed' }),
      event({ at: '2026-11-14T09:00:00Z', kind: 'imported' }),
      event({ at: '2026-11-14T10:00:00Z', kind: 'manual_created' }),
    ],
    TODAY,
    7,
  );
  const today = series.find((point) => point.date === TODAY)!;
  assert.equal(today.closed, 1);
  assert.equal(today.arrived, 0);

  const yesterday = series.find((point) => point.date === '2026-11-14')!;
  assert.equal(yesterday.arrived, 2);
});

test('states inside the pipeline are not counted as arrivals or closures', () => {
  // assigned/started/blocked would count the same job several times a day.
  const series = movementSeries(
    ['assigned', 'started', 'blocked', 'resumed', 'scheduled'].map((kind) =>
      event({ at: '2026-11-15T09:00:00Z', kind }),
    ),
    TODAY,
    7,
  );
  const today = series.find((point) => point.date === TODAY)!;
  assert.equal(today.arrived, 0);
  assert.equal(today.closed, 0);
});

test('events outside the window are ignored, not clamped into it', () => {
  const series = movementSeries([event({ at: '2026-01-01T09:00:00Z', kind: 'completed' })], TODAY, 7);
  assert.equal(
    series.reduce((sum, point) => sum + point.closed, 0),
    0,
  );
});

test('the series peak is at least one, so a bar is never a divide by zero', () => {
  assert.equal(seriesPeak([]), 1);
  assert.equal(seriesPeak(movementSeries([], TODAY, 7)), 1);
});

test('a growing backlog is said in words, not left as arithmetic', () => {
  const text = movementSummary(
    [
      { date: '2026-11-14', label: 'Fri', arrived: 9, closed: 2 },
      { date: '2026-11-15', label: 'Sat', arrived: 1, closed: 0 },
    ],
    'en',
  );
  assert.match(text, /backlog grew by 8/);
});

test('a falling backlog is said plainly too', () => {
  const text = movementSummary([{ date: '2026-11-15', label: 'Sat', arrived: 1, closed: 5 }], 'en');
  assert.match(text, /fell by 4/);
});

test('a level day is called level rather than a negative zero', () => {
  const text = movementSummary([{ date: '2026-11-15', label: 'Sat', arrived: 3, closed: 3 }], 'en');
  assert.match(text, /level/);
  assert.doesNotMatch(text, /fell by 0|grew by 0/);
});

test('a silent week says so', () => {
  assert.match(movementSummary(movementSeries([], TODAY, 7), 'en'), /No movement/);
});

test('a silent week names the last busy day, so silence is not mistaken for a broken feed', () => {
  // On the live database the newest activity was 16 Nov while the clock read
  // 24 Nov: a seven-day window was empty and the page would have said nothing
  // at all. The date is what tells "quiet week" from "feed is down".
  const text = movementSummary(movementSeries([], TODAY, 7), 'en', '2026-11-16');
  assert.match(text, /No movement/);
  assert.match(text, /2026-11-16/);
  assert.notEqual(text, movementSummary(movementSeries([], TODAY, 7), 'en'));
});

test('the last activity day is the newest event, whatever order it arrived in', () => {
  assert.equal(
    lastActivityDay([
      event({ at: '2026-11-14T09:00:00Z' }),
      event({ at: '2026-11-16T09:00:00Z' }),
      event({ at: '2026-11-15T09:00:00Z' }),
    ]),
    '2026-11-16',
  );
  assert.equal(lastActivityDay([]), null);
  assert.equal(lastActivityDay([event({ at: null as unknown as string })]), null);
});

test('a quiet day still shows its own summary rather than the last-activity line', () => {
  // The fallback must only fire when the whole window is empty.
  const text = movementSummary([{ date: TODAY, label: 'Sat', arrived: 1, closed: 0 }], 'en', '2026-11-01');
  assert.doesNotMatch(text, /Last activity/);
});

/* -------------------------------------------------------------------------- */
/* The feed                                                                   */
/* -------------------------------------------------------------------------- */

test('the feed is newest first and bounded', () => {
  const rows = recentEvents(
    [
      event({ at: '2026-11-14T09:00:00Z', task_id: 'old' }),
      event({ at: '2026-11-15T09:00:00Z', task_id: 'new' }),
      event({ at: '2026-11-13T09:00:00Z', task_id: 'older' }),
    ],
    2,
  );
  assert.deepEqual(
    rows.map((row) => row.task_id),
    ['new', 'old'],
  );
});

test('the feed keeps good news as well as bad', () => {
  // A feed that only shows problems trains a supervisor to ignore it.
  const rows = recentEvents([event({ kind: 'completed' }), event({ kind: 'blocked' })], 6);
  assert.equal(rows.length, 2);
});

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

test('the greeting follows the local hour', () => {
  assert.match(greeting(7, 'en'), /morning/i);
  assert.match(greeting(13, 'en'), /afternoon/i);
  assert.match(greeting(21, 'en'), /evening/i);
  assert.notEqual(greeting(7, 'en'), greeting(7, 'so'));
});

test('the freshness label never reads as an alarm until it is old', () => {
  assert.match(updatedLabel(3, 'en'), /just now/);
  assert.match(updatedLabel(30, 'en'), /30s ago/);
  assert.match(updatedLabel(120, 'en'), /2m ago/);
  assert.match(updatedLabel(7200, 'en'), /2h ago/);
  assert.match(updatedLabel(null, 'en'), /Not refreshed yet/);
});

test('the notes say people are not ranked, in both languages', () => {
  assert.match(OVERVIEW_NOTE.en, /never ranked/);
  assert.match(OVERVIEW_NOTE.so, /lama kala dhig-dhigo/);
});

test('the work note explains which day the age counts from', () => {
  assert.match(WORK_NOTE.en, /day the customer reported/);
  assert.match(WORK_NOTE.so, /maalinta macmiilku soo sheegay/);
});

/* -------------------------------------------------------------------------- */
/* Partial failure                                                            */
/* -------------------------------------------------------------------------- */

test('a total failure is not disguised as a partial one', () => {
  // A hard-coded threshold sat here first and was wrong the moment a fifth
  // source was added: four of five failed and the page still said "everything
  // else is working".
  assert.equal(nothingLoaded([]), false);
  assert.equal(nothingLoaded(['today', 'tasks']), false);
  assert.equal(nothingLoaded(['today', 'tasks', 'load', 'events']), false);
  assert.equal(nothingLoaded(['today', 'tasks', 'load', 'events', 'members']), true);
  assert.equal(OVERVIEW_SOURCE_COUNT, 5);
});

test('the notice names what failed instead of saying "could not load"', () => {
  // "Could not load" alone leaves a supervisor refreshing a page that is 80%
  // working and concluding the whole system is down.
  const text = partialNotice(['load', 'events'], 'en')!;
  assert.match(text, /crew list/);
  assert.match(text, /activity feed/);
  assert.match(text, /still working/);
});

test('the notice is translated and absent when nothing failed', () => {
  assert.equal(partialNotice([], 'en'), null);
  assert.match(partialNotice(['load'], 'so')!, /shaqaalaha/);
});

test('every part has a name in both languages', () => {
  const parts = ['today', 'tasks', 'load', 'events', 'members'] as const;
  for (const part of parts) {
    assert.ok(partLabel(part, 'en').length > 0, part);
    assert.ok(partLabel(part, 'so').length > 0, part);
    assert.notEqual(partLabel(part, 'en'), partLabel(part, 'so'), part);
  }
});
