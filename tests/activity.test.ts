import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityDetail,
  activityLabel,
  activityTone,
  actorsIn,
  agingBand,
  agingLabel,
  buildActivityCsv,
  countByKind,
  countLate,
  filterEvents,
  isKnownKind,
  SLA_DAYS,
  waitingDays,
  type ActivityEvent,
} from '../src/lib/activity';

/**
 * Batch H — the audit trail and the aging rule.
 *
 * Both are rules a head manager will be shown on a screen and quoted in a
 * meeting, so both are tested as rules rather than as rendering. The two that
 * matter most: a job is not late on the day it arrives (only after the promise),
 * and an event kind we do not recognise still appears in the feed instead of
 * vanishing.
 */

const NOW = new Date(2026, 10, 9, 12, 0, 0); // 9 Nov 2026, local noon

function event(over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    at: '2026-11-09T09:15:00+00:00',
    kind: 'completed',
    subject: 'job',
    task_id: 'task-1',
    line_number: '634477140',
    customer_name: 'Cabdiraxmaan Maxamed',
    actor: 'F1 Supervisor (Kormeeraha F1)',
    seconds: 3600,
    dbm: -21.4,
    reason: null,
    notes: null,
    channel: null,
    task_count: null,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Aging                                                                       */
/* -------------------------------------------------------------------------- */

test('aging: the promise is three days', () => {
  assert.equal(SLA_DAYS, 3);
});

test('aging: bands sit on the boundary, not around it', () => {
  assert.equal(agingBand(0), 'fresh');
  assert.equal(agingBand(1), 'fresh');
  assert.equal(agingBand(2), 'fresh');
  assert.equal(agingBand(3), 'due');
  assert.equal(agingBand(4), 'late');
  assert.equal(agingBand(30), 'late');
});

test('aging: an unknown date is not an accusation', () => {
  assert.equal(agingBand(null), 'fresh');
  assert.equal(waitingDays({ reported_date: null, created_at: null }, NOW), null);
});

test('aging: days are counted from the reported date, not from the import', () => {
  // Reported five days ago, read into the system today.
  const task = { reported_date: '2026-11-04', created_at: '2026-11-09T00:10:00+00:00' };
  assert.equal(waitingDays(task, NOW), 5);
  assert.equal(agingBand(waitingDays(task, NOW)), 'late');
});

test('aging: a missing reported date falls back to created_at', () => {
  const task = { reported_date: null, created_at: '2026-11-07T08:00:00+00:00' };
  assert.equal(waitingDays(task, NOW), 2);
  assert.equal(agingBand(waitingDays(task, NOW)), 'fresh');
});

test('aging: a clock skewed into the future never reads as negative wait', () => {
  assert.equal(waitingDays({ reported_date: '2026-11-12' }, NOW), 0);
});

test('aging: labels read naturally in both languages', () => {
  assert.equal(agingLabel(0, 'en'), 'Today');
  assert.equal(agingLabel(0, 'so'), 'Maanta');
  assert.equal(agingLabel(1, 'en'), '1 day');
  assert.equal(agingLabel(4, 'en'), '4 days');
  assert.equal(agingLabel(1, 'so'), '1 maalmood');
});

test('aging: finishing a job takes it off the late list', () => {
  const old = { status: 'pending', reported_date: '2026-11-01' };
  const counts = countLate(
    [old, { ...old, status: 'completed' }, { ...old, status: 'cancelled' }, { status: 'in_progress', reported_date: '2026-11-06' }],
    NOW,
  );
  assert.deepEqual(counts, { due: 1, late: 1 });
});

/* -------------------------------------------------------------------------- */
/* The feed                                                                    */
/* -------------------------------------------------------------------------- */

test('feed: an unknown kind renders as itself instead of disappearing', () => {
  assert.equal(isKnownKind('teleported'), false);
  assert.equal(activityLabel('teleported', 'en'), 'teleported');
  assert.equal(activityTone('teleported'), 'neutral');
});

test('feed: both languages have a word for every kind we ship', () => {
  for (const kind of ['imported', 'assigned', 'started', 'blocked', 'completed', 'cancelled', 'dispatched']) {
    assert.ok(isKnownKind(kind), `${kind} should be known`);
    assert.notEqual(activityLabel(kind, 'en'), kind);
    assert.notEqual(activityLabel(kind, 'so'), kind);
    assert.notEqual(activityLabel(kind, 'so'), activityLabel(kind, 'en'));
  }
});

test('feed: the detail line says what changed, not that something changed', () => {
  assert.match(activityDetail(event({ seconds: 3600 + 29 * 60 }), 'en') ?? '', /1h 29m/);
  assert.match(activityDetail(event({ kind: 'completed', dbm: -22.86 }), 'en') ?? '', /-22\.9/);
  assert.equal(activityDetail(event({ kind: 'cancelled', reason: 'Macmiil ma joogo' }), 'so'), 'Macmiil ma joogo');
  assert.equal(
    activityDetail(event({ kind: 'dispatched', subject: 'dispatch', channel: 'telegram', task_count: 7 }), 'en'),
    'Telegram · 7 jobs',
  );
  assert.equal(
    activityDetail(event({ kind: 'dispatched', subject: 'dispatch', channel: 'whatsapp', task_count: 7 }), 'so'),
    'WhatsApp · 7 shaqo',
  );
});

test('feed: filters compose, and the search looks at what a supervisor remembers', () => {
  const events = [
    event({ kind: 'completed', actor: 'Cabdi', line_number: '634477140' }),
    event({ kind: 'blocked', actor: 'Mustafe', line_number: '634477199', reason: 'Cable la gooyay' }),
    event({ kind: 'completed', actor: 'Mustafe', line_number: '634477141', notes: 'Booster beddelan' }),
  ];

  assert.equal(filterEvents(events, { kind: 'completed' }).length, 2);
  assert.equal(filterEvents(events, { kind: 'completed', actor: 'Mustafe' }).length, 1);
  assert.equal(filterEvents(events, { query: '634477140' }).length, 1);
  assert.equal(filterEvents(events, { query: 'CABLE la gooyay' }).length, 1);
  assert.equal(filterEvents(events, { query: 'booster' }).length, 1);
  assert.equal(filterEvents(events, { kind: 'all', actor: 'all', query: '   ' }).length, 3);
  assert.equal(filterEvents(events, { query: 'nothing matches this' }).length, 0);
});

test('feed: counts and the actor list are stable for the chips', () => {
  const events = [event({ actor: 'Mustafe' }), event({ actor: 'Cabdi' }), event({ actor: 'Mustafe' })];
  assert.deepEqual(countByKind(events), { completed: 3 });
  assert.deepEqual(actorsIn(events), ['Cabdi', 'Mustafe']);
});

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

test('csv: a name with a comma or a quote does not break the file', () => {
  const csv = buildActivityCsv(
    [event({ customer_name: 'Maxamed, "Madoobe"', notes: null })],
    'en',
  );
  const [header, row] = csv.split('\n');
  assert.equal(header, 'When,Action,Line,Customer,Who,Detail');
  assert.ok(row.includes('"Maxamed, ""Madoobe"""'), row);
});

test('csv: the header follows the language of the person exporting', () => {
  assert.match(buildActivityCsv([], 'so').split('\n')[0], /^Waqti,Ficil,Khad/);
  assert.match(buildActivityCsv([], 'en').split('\n')[0], /^When,Action,Line/);
});

test('csv: a newline inside a note stays inside one quoted cell', () => {
  const csv = buildActivityCsv(
    [event({ kind: 'reopened', reason: null, dbm: null, seconds: null, notes: 'line one\nline two' })],
    'en',
  );
  assert.equal(csv.split('\n').length, 3); // header, then a quoted two-line row
  assert.ok(csv.includes('"line one\nline two"'));
});

/* -------------------------------------------------------------------------- */
/* Wiring — the parts a pure test cannot see                                   */
/* -------------------------------------------------------------------------- */

test('wiring: the report is reachable from Analytics, and print hides the app', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

  const analytics = read('src/components/supervisor/Analytics.tsx');
  assert.match(analytics, /import \{ PeriodReportSheet \}/, 'a built component that nothing opens is not a feature');
  assert.match(analytics, /<PeriodReportSheet open=/, 'the sheet must be mounted');
  assert.match(analytics, /setReportOpen\(true\)/, 'and something must be able to open it');

  const css = read('src/index.css');
  assert.match(css, /body:has\(\.print-root\)/, 'the app hides itself when the report prints');

  const shell = read('src/components/supervisor/SupervisorShell.tsx');
  assert.match(shell, /ActivityLog/, 'the Record tab must be mounted');
});
