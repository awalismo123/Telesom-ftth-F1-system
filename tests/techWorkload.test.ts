import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  WORKLOAD_NOTE,
  alphabetical,
  hasOutlier,
  implausibleNote,
  longestMinutes,
  median,
  medianMinutes,
  medianLabel,
  nothingCompleted,
  openTotal,
  peakDay,
  visibleTechs,
  workloadLabel,
  type TechRow,
} from '../src/lib/techWorkload';

/**
 * A panel that says who is busy is one design decision away from being a
 * leaderboard. These tests hold that line, and pin the statistics that make the
 * times honest.
 */

const tech = (over: Partial<TechRow> = {}): TechRow => ({
  user_id: 'u1',
  name: 'Cabdiraxmaan Maxamed',
  role: 'technician',
  open_now: 0,
  running_now: 0,
  blocked_now: 0,
  completed: 0,
  durations: [],
  implausible_timers: 0,
  open_by_day: [],
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The median                                                                 */
/* -------------------------------------------------------------------------- */

test('the median of an odd count is the middle value', () => {
  assert.equal(median([30, 10, 20]), 20);
});

test('the median of an even count is the mean of the two middle values', () => {
  // 4 jobs: 10, 20, 30, 61 minutes -> (20 + 30) / 2.
  assert.equal(median([600, 1200, 1800, 3660]), 1500);
});

test('a single job is its own median', () => {
  assert.equal(median([1234]), 1234);
});

test('no jobs is null, not zero', () => {
  // Zero would claim somebody did a job in no time at all.
  assert.equal(median([]), null);
  assert.equal(medianMinutes([]), null);
});

test('the median survives the 45.7-hour timer that breaks the average', () => {
  // This is the live case from KNOWN_LIMITS §7d: 29s, 201s, 164625s (45.7h).
  // The average is 18.3 hours and describes nobody's working day.
  const live = [29, 201, 164625];
  const avgMinutes = live.reduce((a, b) => a + b, 0) / live.length / 60;
  assert.ok(avgMinutes > 900, 'the average really is meaningless here');
  assert.equal(medianMinutes(live), 3, 'the median is 201 seconds');
});

test('the median does not mutate its input', () => {
  const input = [30, 10, 20];
  median(input);
  assert.deepEqual(input, [30, 10, 20]);
});

test('median minutes are rounded to whole minutes', () => {
  assert.equal(medianMinutes([90, 90]), 2); // 1.5 -> 2
});

/* -------------------------------------------------------------------------- */
/* The outlier the median hides                                               */
/* -------------------------------------------------------------------------- */

test('the longest job is reported beside the median', () => {
  // The median is robust, but a 45-hour timer should still be visible rather
  // than quietly averaged away.
  assert.equal(longestMinutes([29, 201, 164625]), 2744);
  assert.equal(longestMinutes([]), null);
});

test('a wild maximum is flagged as an outlier', () => {
  assert.equal(hasOutlier([29, 201, 164625]), true);
});

test('a normal spread is not flagged', () => {
  // 20, 30, 45, 55 minutes — a busy but ordinary day.
  assert.equal(hasOutlier([1200, 1800, 2700, 3300]), false);
});

test('a short median with one long job is still an outlier', () => {
  assert.equal(hasOutlier([60, 60, 7200]), true);
});

test('the outlier rule does not fire on near-zero medians by accident', () => {
  // A median of 0 minutes cannot be multiplied by four, so an absolute floor
  // of one hour applies instead of a ratio.
  assert.equal(hasOutlier([0, 0, 7200]), true, '2 hours beside a 0-minute median');
  assert.equal(hasOutlier([0, 0, 3000]), false, '50 minutes is not an outlier');
  assert.equal(hasOutlier([0, 0, 60]), false, '1 minute is not an outlier');
});

/* -------------------------------------------------------------------------- */
/* No ranking, ever                                                           */
/* -------------------------------------------------------------------------- */

test('the panel is alphabetical', () => {
  const rows = [
    tech({ user_id: 'a', name: 'Xasan' }),
    tech({ user_id: 'b', name: 'Cabdi' }),
    tech({ user_id: 'c', name: 'Maxamed' }),
  ];
  assert.deepEqual(
    alphabetical(rows).map((row) => row.name),
    ['Cabdi', 'Maxamed', 'Xasan'],
  );
});

test('alphabetical order does not depend on how many jobs anybody closed', () => {
  const rows = [
    tech({ user_id: 'a', name: 'Ayaan', completed: 0 }),
    tech({ user_id: 'b', name: 'Bashir', completed: 99 }),
  ];
  // If this ever starts returning Bashir first, somebody has reintroduced a
  // leaderboard.
  assert.deepEqual(
    alphabetical(rows).map((row) => row.name),
    ['Ayaan', 'Bashir'],
  );
});

test('sorting does not mutate its input', () => {
  const rows = [tech({ user_id: 'a', name: 'Z' }), tech({ user_id: 'b', name: 'A' })];
  alphabetical(rows);
  assert.equal(rows[0].name, 'Z');
});

test('every active technician is listed, including one with no work', () => {
  // An empty week is a fact, not an absence to hide.
  const rows = [
    tech({ user_id: 'a', name: 'Ayaan' }),
    tech({ user_id: 'b', name: 'Bashir', completed: 4 }),
  ];
  assert.equal(visibleTechs(rows).length, 2);
});

test('an idle supervisor is not a row of zeros on a panel about technicians', () => {
  const rows = [
    tech({ user_id: 'a', name: 'Ayaan' }),
    tech({ user_id: 's', name: 'F1 Supervisor', role: 'supervisor' }),
  ];
  assert.deepEqual(
    visibleTechs(rows).map((row) => row.name),
    ['Ayaan'],
  );
});

test('a supervisor who closed jobs themselves is shown', () => {
  const rows = [
    tech({ user_id: 'a', name: 'Ayaan' }),
    tech({ user_id: 's', name: 'F1 Supervisor', role: 'supervisor', completed: 2 }),
  ];
  assert.equal(visibleTechs(rows).length, 2);
});

/* -------------------------------------------------------------------------- */
/* Load                                                                       */
/* -------------------------------------------------------------------------- */

test('open jobs are totalled across days', () => {
  const row = tech({
    open_by_day: [
      { date: '2026-11-15', open: 2 },
      { date: '2026-11-16', open: 3 },
    ],
  });
  assert.equal(openTotal(row), 5);
});

test('the busiest day is found', () => {
  const row = tech({
    open_by_day: [
      { date: '2026-11-15', open: 2 },
      { date: '2026-11-16', open: 5 },
      { date: '2026-11-17', open: 1 },
    ],
  });
  assert.deepEqual(peakDay(row), { date: '2026-11-16', open: 5 });
});

test('carrying nothing has no peak day', () => {
  assert.equal(peakDay(tech()), null);
  assert.equal(openTotal(tech()), 0);
});

/* -------------------------------------------------------------------------- */
/* The note is printed, and it is true                                        */
/* -------------------------------------------------------------------------- */

test('the note states that blockers pause the clock', () => {
  // The implementation plan's draft said the time "includes ... blockers".
  // That is false in this app: blocking banks the seconds and clears the start
  // time (005_execution.sql). A disclaimer that misdescribes its own number is
  // worse than none.
  assert.match(WORKLOAD_NOTE.en, /blocker pauses it/i);
  assert.match(WORKLOAD_NOTE.so, /Caqabaddu way joojisaa/i);
});

test('the note says it measures the job, not the person', () => {
  assert.match(WORKLOAD_NOTE.en, /measures the job, not the person/i);
  assert.match(WORKLOAD_NOTE.so, /Waxay cabbirtaa shaqada, ma aha qofka/i);
});

test('the note is translated', () => {
  assert.notEqual(WORKLOAD_NOTE.en, WORKLOAD_NOTE.so);
});

test('the middle figure is called a median in as many words', () => {
  // A number labelled "average" that is really a median is the kind of quiet
  // inaccuracy that gets quoted in a meeting.
  assert.equal(medianLabel('en'), 'median');
  assert.equal(medianLabel('so'), 'dhexdhexaad');
});

test('the heading carries the window', () => {
  for (const days of [7, 30, 90]) {
    assert.match(workloadLabel(days, 'en'), new RegExp(String(days)));
    assert.match(workloadLabel(days, 'so'), new RegExp(String(days)));
  }
});

test('set-aside timers are stated, never silent', () => {
  assert.equal(implausibleNote(0, 'en'), null);
  assert.match(implausibleNote(1, 'en')!, /^1 timer /);
  assert.match(implausibleNote(3, 'en')!, /^3 timers /);
  assert.notEqual(implausibleNote(2, 'en'), implausibleNote(2, 'so'));
});

test('an empty window says so instead of showing a blank', () => {
  assert.match(nothingCompleted('en'), /Nothing completed/);
  assert.match(nothingCompleted('so'), /ma dhammeeyin/);
});

/* -------------------------------------------------------------------------- */
/* The server must agree with the screen                                      */
/* -------------------------------------------------------------------------- */

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/029_tech_workload.sql', import.meta.url)),
  'utf8',
);

test('the server never ranks technicians', () => {
  // ORDER BY name, and nothing else.
  assert.match(sql, /jsonb_agg\(to_jsonb\(x\) ORDER BY x\.name\)/);
  assert.doesNotMatch(sql, /ORDER BY[^)]*completed\s+DESC/);
});

test('impossible timers are counted, not capped or deleted', () => {
  assert.match(sql, /AS implausible_timers/);
  assert.match(
    sql,
    /accumulated_seconds > EXTRACT\(EPOCH FROM \(t2\.completed_at - t2\.created_at\)\)/,
  );
});

test('the duration array excludes only the impossible ones', () => {
  assert.match(
    sql,
    /t3\.accumulated_seconds <= EXTRACT\(EPOCH FROM \(t3\.completed_at - t3\.created_at\)\)/,
  );
});

test('only completed jobs inside the window are timed', () => {
  assert.match(sql, /t2\.status = 'completed'/);
  assert.match(sql, /t2\.completed_at >= v_from_ts/);
  assert.match(sql, /t2\.completed_at < \(CURRENT_DATE \+ 1\)::timestamptz/);
});

test('the completion count is not capped by the duration array limit', () => {
  // If `completed` were counted inside the LIMIT 500 subquery, a technician with
  // more than 500 completions would be understated.
  const counted = sql.indexOf('AS completed');
  const limited = sql.indexOf('LIMIT 500');
  assert.ok(counted > 0 && limited > 0);
  assert.ok(counted < limited, 'the count must be computed outside the limited set');
});

test('a technician cannot read the workforce panel', () => {
  assert.match(sql, /IF v_caller\.role = 'technician' THEN\s*RAISE EXCEPTION/);
});
