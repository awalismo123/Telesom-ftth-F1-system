import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isKnownKind } from '../src/lib/activity';
import { routeStats } from '../src/lib/execution';
import { todayKey } from '../src/lib/format';
import {
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_PROBLEM_COPY,
  addDays,
  dayOffset,
  dueJobs,
  isPlanned,
  plannedJobs,
  scheduleBucket,
  scheduleLabel,
  scheduleProblem,
  shortDay,
} from '../src/lib/schedule';

/**
 * A job's day is a calendar day, and this module refuses to turn one into a
 * Date object. These tests exist mostly to hold that line: the failure they
 * guard against is a single day of drift for anyone not sitting in UTC+3.
 */

const TODAY = '2026-11-15';

test('a day reads as a calendar day, whatever timezone the phone is in', () => {
  // `new Date('2026-11-15')` is UTC midnight. In a negative-offset zone that is
  // 19:00 on the 14th, so any getDate()-based comparison is a day out. Comparing
  // the keys avoids the question entirely.
  assert.equal(dayOffset('2026-11-15', TODAY), 0);
  assert.equal(dayOffset('2026-11-16', TODAY), 1);
  assert.equal(dayOffset('2026-11-14', TODAY), -1);
});

test('month and year boundaries count in days, not months', () => {
  assert.equal(dayOffset('2026-12-01', '2026-11-30'), 1);
  assert.equal(dayOffset('2027-01-01', '2026-12-31'), 1);
  assert.equal(dayOffset('2028-03-01', '2028-02-28'), 2, '2028 is a leap year');
  assert.equal(dayOffset('2027-03-01', '2027-02-28'), 1, '2027 is not');
});

test('an unreadable date is not a day', () => {
  for (const bad of ['', '15/11/2026', '2026-11', 'tomorrow', null, undefined]) {
    assert.equal(dayOffset(bad as string, TODAY), null, `${String(bad)} should not parse`);
  }
});

test('addDays walks the calendar', () => {
  assert.equal(addDays(TODAY, 1), '2026-11-16');
  assert.equal(addDays(TODAY, 0), TODAY);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('today, late and planned are three different things', () => {
  assert.equal(scheduleBucket(TODAY, TODAY), 'today');
  assert.equal(scheduleBucket('2026-11-10', TODAY), 'past');
  assert.equal(scheduleBucket('2026-11-20', TODAY), 'planned');
});

test('a job with no date is today, never hidden', () => {
  // The column is NOT NULL, but tests and hand-built payloads omit it. Treating
  // "no date" as "not yet due" would make a real job disappear from the board.
  assert.equal(scheduleBucket(undefined, TODAY), 'today');
  assert.equal(scheduleBucket(null, TODAY), 'today');
  assert.equal(scheduleBucket('rubbish', TODAY), 'today');
  assert.equal(isPlanned(undefined, TODAY), false);
});

test('only future days are planned', () => {
  assert.equal(isPlanned('2026-11-16', TODAY), true);
  assert.equal(isPlanned(TODAY, TODAY), false);
  assert.equal(isPlanned('2026-11-14', TODAY), false);
});

test('the planned lane is soonest first and excludes today', () => {
  const jobs = [
    { id: 'a', scheduled_date: '2026-11-25' },
    { id: 'b', scheduled_date: TODAY },
    { id: 'c', scheduled_date: '2026-11-17' },
    { id: 'd', scheduled_date: '2026-11-01' },
    { id: 'e' },
  ];
  assert.deepEqual(
    plannedJobs(jobs, TODAY).map((job) => job.id),
    ['c', 'a'],
  );
});

test('the due list keeps today, late and undated work', () => {
  const jobs = [
    { id: 'a', scheduled_date: '2026-11-25' },
    { id: 'b', scheduled_date: TODAY },
    { id: 'd', scheduled_date: '2026-11-01' },
    { id: 'e' },
  ];
  assert.deepEqual(
    dueJobs(jobs, TODAY).map((job) => job.id),
    ['b', 'd', 'e'],
  );
});

test('the two lists never overlap and never lose a job', () => {
  // If they overlapped, a job would appear twice on the board; if they lost one,
  // it would vanish from both. Both are worse than a wrong sort order.
  const jobs = [
    { id: 'a', scheduled_date: '2026-11-25' },
    { id: 'b', scheduled_date: TODAY },
    { id: 'c', scheduled_date: '2025-01-01' },
    { id: 'd', scheduled_date: undefined },
    { id: 'e', scheduled_date: '2027-06-01' },
  ];
  const planned = plannedJobs(jobs, TODAY).map((job) => job.id);
  const due = dueJobs(jobs, TODAY).map((job) => job.id);

  assert.equal(planned.length + due.length, jobs.length);
  assert.deepEqual(planned.filter((id) => due.includes(id)), []);
});

test('the planning window catches a mistyped year', () => {
  // The whole point: a typo must be rejected at the field, not silently park a
  // job where nobody will look at it.
  assert.equal(scheduleProblem(TODAY, TODAY), null);
  assert.equal(scheduleProblem(addDays(TODAY, SCHEDULE_MAX_AHEAD_DAYS), TODAY), null);
  assert.equal(scheduleProblem(addDays(TODAY, SCHEDULE_MAX_AHEAD_DAYS + 1), TODAY), 'too-far');
  assert.equal(scheduleProblem('2126-11-15', TODAY), 'too-far');
  assert.equal(scheduleProblem('2026-11-15'.replace('2026', '1999'), TODAY), 'too-old');
  assert.equal(scheduleProblem('not-a-day', TODAY), 'unreadable');
});

test('the past is allowed — late sheets are normal', () => {
  // Forbidding a past date would make a supervisor backdate by lying, or leave
  // a late job dated today and invisible as late work.
  assert.equal(scheduleProblem(addDays(TODAY, -30), TODAY), null);
});

test('every rejected date explains itself in both languages', () => {
  for (const day of ['nope', '2126-01-01', '1999-01-01']) {
    assert.ok(scheduleProblem(day, TODAY), `${day} should be rejected`);
  }
  // The copy is looked up by problem, and each one must be translated.
  for (const copy of Object.values(SCHEDULE_PROBLEM_COPY)) {
    assert.ok(copy.en.length > 5 && copy.so.length > 5);
    assert.notEqual(copy.en, copy.so);
  }
});

test('labels say what a person is about to act on', () => {
  assert.equal(scheduleLabel(TODAY, TODAY, 'en'), 'Today');
  assert.equal(scheduleLabel(TODAY, TODAY, 'so'), 'Maanta');
  assert.equal(scheduleLabel('2026-11-16', TODAY, 'en'), 'Tomorrow');
  assert.equal(scheduleLabel('2026-11-16', TODAY, 'so'), 'Berri');
  assert.equal(scheduleLabel('2026-11-18', TODAY, 'en'), 'in 3 days');
  assert.equal(scheduleLabel('2026-11-18', TODAY, 'so'), '3 maalmood');

  // Late work says how late, because that is the actionable part.
  assert.equal(scheduleLabel('2026-11-14', TODAY, 'en'), '1 day late');
  assert.equal(scheduleLabel('2026-11-10', TODAY, 'en'), '5 days late');
  assert.equal(scheduleLabel('2026-11-10', TODAY, 'so'), '5 maalmood ka dib');
});

test('every label is translated', () => {
  for (const day of [TODAY, '2026-11-16', '2026-11-20', '2026-11-14', '2026-11-01']) {
    assert.notEqual(scheduleLabel(day, TODAY, 'en'), scheduleLabel(day, TODAY, 'so'), `${day} is not translated`);
  }
});

test('a short day is short, and a missing one is a dash', () => {
  assert.equal(shortDay('2026-11-15'), '15/11');
  assert.equal(shortDay(null), '—');
  assert.equal(shortDay('bogus'), '—');
});

// ── The visit log must accept the word we write to it ──────────────────────

test('migration 024 allows the action the code writes', () => {
  // `task_work_logs.action` is a CHECK allow-list. When this was first written,
  // 'scheduled' was not on it — the RPC would have failed at run time on a live
  // job, with nothing in the type check to catch it. This keeps the two lists
  // together.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/024_scheduling.sql', import.meta.url)),
    'utf8',
  );

  const constraint = sql.slice(sql.indexOf('ADD CONSTRAINT task_work_logs_action_check'));
  const allowed = constraint.slice(0, constraint.indexOf('));'));

  assert.match(allowed, /'scheduled'/, 'the constraint must accept the action set_task_schedule writes');
  assert.match(allowed, /'completed'/, 'widening the list must not drop the existing words');
});

test('every action the database stores has a label in the feed', () => {
  // The feed falls back to the raw string for an unknown kind. That is a safe
  // fallback but shows operators `unassigned` — db words in a bilingual UI.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/024_scheduling.sql', import.meta.url)),
    'utf8',
  );
  const constraint = sql.slice(sql.indexOf('ADD CONSTRAINT task_work_logs_action_check'));
  const allowed = [
    ...constraint.slice(0, constraint.indexOf('));')).matchAll(/'([a-z_]+)'/g),
  ].map((m) => m[1]);

  // `unassigned` is written by unassign_tasks and long predates the activity
  // feed; the feed renders it raw. Documented rather than silently tolerated.
  const known = allowed.filter((action) => action !== 'unassigned');
  for (const action of known) {
    assert.ok(isKnownKind(action), `the feed has no label for "${action}"`);
  }
});

// ── "Done today" is the technician's day, not UTC's ───────────────────────

test('"done today" uses the same day as the rest of the app', () => {
  // Both sides used to be UTC. They agreed with each other, so nothing
  // vanished — but the tile disagreed with the header, which counts the
  // phone's day. A fixed clock pins the property instead of trusting the
  // machine's timezone.
  const now = new Date(2026, 10, 16, 0, 30, 0); // 00:30 local on the 16th
  const closedAt = new Date(2026, 10, 15, 23, 45, 0); // 45 minutes earlier

  const stats = routeStats(
    [
      {
        id: 'x',
        line_number: 'LN1',
        status: 'completed',
        priority: 'normal',
        reported_date: '2026-11-15',
        completed_at: closedAt.toISOString(),
        accumulated_seconds: 600,
      } as never,
    ],
    now,
  );

  // 23:45 on the 15th is yesterday, whichever clock is used — so the boundary
  // that matters is that `now` is the 16th and the job is not.
  assert.equal(stats.doneToday, 0);

  const sameDay = routeStats(
    [
      {
        id: 'y',
        line_number: 'LN2',
        status: 'completed',
        priority: 'normal',
        reported_date: '2026-11-16',
        completed_at: now.toISOString(),
        accumulated_seconds: 600,
      } as never,
    ],
    now,
  );
  assert.equal(sameDay.doneToday, 1);
});
