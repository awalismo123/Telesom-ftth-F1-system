import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SLA_DAYS, agingBand } from '../src/lib/activity';
import {
  SLA_NOTE,
  dueToday,
  isDueToday,
  lateNote,
  slaHeadline,
  slaHeading,
  urgentFirst,
  type DueJob,
  type SlaWatch,
} from '../src/lib/slaWatch';

/**
 * The promise is three days. This feature points at the jobs that reach the
 * deadline today, so the boundary is the whole test: off by one and the list
 * either shows jobs that are already lost or hides the ones that are not.
 */

const job = (over: Partial<DueJob> = {}): DueJob => ({
  id: 't1',
  line_number: '575373',
  customer_name: 'Cabdi Xasan',
  customer_phone: '0634111111',
  xaafada: 'JIGJIGAYAR',
  cablebox_code_raw: 'FAT48',
  status: 'assigned',
  priority: 'normal',
  reported_date: '2026-11-12',
  days_waiting: 3,
  assignee: 'Mustafe Axmed Xuseen',
  is_unassigned: false,
  ...over,
});

const watch = (over: Partial<SlaWatch> = {}): SlaWatch => ({
  sla_days: 3,
  today: '2026-11-15',
  due_today: [job()],
  due_count: 1,
  late_count: 0,
  open_count: 10,
  unassigned_due: 0,
  server_now: '2026-11-15T08:00:00Z',
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The boundary — unchanged, and it is three                                   */
/* -------------------------------------------------------------------------- */

test('the promise is still three days', () => {
  assert.equal(SLA_DAYS, 3);
});

test('a job at exactly three days is due, at four is late', () => {
  // Pinned because the whole feature depends on this boundary, and
  // `agingBand` is what every job card already shows.
  assert.equal(agingBand(2), 'fresh');
  assert.equal(agingBand(3), 'due');
  assert.equal(agingBand(4), 'late');
});

test('the boundary does not move if the server ever sends a different number', () => {
  // The server sends its own `sla_days`; the screen follows it rather than
  // quietly disagreeing.
  assert.equal(isDueToday(job({ days_waiting: 5 }), 5), true);
  assert.equal(isDueToday(job({ days_waiting: 4 }), 5), false);
});

test('a late job is never shown as due today', () => {
  // The one claim that would send a supervisor looking in the wrong place.
  const w = watch({ due_today: [job({ days_waiting: 4 })] });
  assert.deepEqual(dueToday(w), []);
});

test('a job that is not at the deadline yet is not shown', () => {
  assert.deepEqual(dueToday(watch({ due_today: [job({ days_waiting: 1 })] })), []);
});

test('no data is an empty list, not a crash', () => {
  assert.deepEqual(dueToday(null), []);
  assert.deepEqual(dueToday(undefined), []);
});

/* -------------------------------------------------------------------------- */
/* Order — who to ring first                                                  */
/* -------------------------------------------------------------------------- */

test('unassigned jobs come first', () => {
  // Nobody is going to touch them otherwise.
  const rows = [
    job({ line_number: 'A', is_unassigned: false, priority: 'urgent' }),
    job({ line_number: 'B', is_unassigned: true, priority: 'normal' }),
  ];
  assert.deepEqual(
    urgentFirst(rows).map((row) => row.line_number),
    ['B', 'A'],
  );
});

test('urgent comes before normal among assigned jobs', () => {
  const rows = [
    job({ line_number: 'A', priority: 'normal' }),
    job({ line_number: 'B', priority: 'urgent' }),
  ];
  assert.deepEqual(
    urgentFirst(rows).map((row) => row.line_number),
    ['B', 'A'],
  );
});

test('the oldest report comes next, then line number', () => {
  const rows = [
    job({ line_number: 'Z', reported_date: '2026-11-12' }),
    job({ line_number: 'A', reported_date: '2026-11-12' }),
    job({ line_number: 'M', reported_date: '2026-11-11' }),
  ];
  assert.deepEqual(
    urgentFirst(rows).map((row) => row.line_number),
    ['M', 'A', 'Z'],
  );
});

test('ordering does not mutate the input', () => {
  const rows = [job({ line_number: 'Z' }), job({ line_number: 'A' })];
  urgentFirst(rows);
  assert.equal(rows[0].line_number, 'Z');
});

/* -------------------------------------------------------------------------- */
/* The headline                                                               */
/* -------------------------------------------------------------------------- */

test('the headline says there is nothing due when there is nothing', () => {
  // Silently rendering nothing would leave a supervisor unsure whether the
  // panel loaded.
  assert.match(slaHeadline(watch({ due_count: 0, due_today: [] }), 'en'), /No job reaches 3 days/);
  assert.match(slaHeadline(watch({ due_count: 0, due_today: [] }), 'so'), /ma gaarto/);
});

test('the headline leads with the number', () => {
  const text = slaHeadline(watch({ due_count: 2 }), 'en');
  assert.match(text, /^2 jobs/);
});

test('one job is singular', () => {
  assert.match(slaHeadline(watch({ due_count: 1 }), 'en'), /^1 job reaches/);
});

test('unassigned work is called out first', () => {
  const text = slaHeadline(watch({ due_count: 3, unassigned_due: 2 }), 'en');
  assert.match(text, /nobody assigned/);
  assert.doesNotMatch(text, /promise still holds/);
});

test('the headline never says "SLA"', () => {
  // The acronym means nothing on the floor; the department says "three days".
  assert.doesNotMatch(slaHeadline(watch(), 'en'), /SLA/);
  assert.doesNotMatch(slaHeading('en'), /SLA/i);
});

test('the headline is translated', () => {
  assert.notEqual(slaHeadline(watch(), 'en'), slaHeadline(watch(), 'so'));
});

test('no payload means no headline rather than a wrong one', () => {
  assert.equal(slaHeadline(null, 'en'), '');
});

/* -------------------------------------------------------------------------- */
/* Not another overdue counter                                                */
/* -------------------------------------------------------------------------- */

test('the note says these jobs are not late yet', () => {
  assert.match(SLA_NOTE.en, /not late yet/i);
  assert.match(SLA_NOTE.so, /Weli ma daahin/i);
});

test('late jobs are counted separately so the lists are never confused', () => {
  assert.equal(lateNote(0, 'en'), null);
  assert.match(lateNote(4, 'en')!, /not in this list/);
  assert.match(lateNote(1, 'en')!, /^1 job has already/);
  assert.notEqual(lateNote(4, 'en'), lateNote(4, 'so'));
});

/* -------------------------------------------------------------------------- */
/* The database must use the same boundary                                    */
/* -------------------------------------------------------------------------- */

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/031_sla_watch.sql', import.meta.url)),
  'utf8',
);

test('the SQL deadline is three, and it is a constant', () => {
  assert.match(sql, /v_sla constant int := 3;/);
});

test('the SQL treats exactly three days as due, not late', () => {
  // `= CURRENT_DATE - 3` for due, `< CURRENT_DATE - 3` for late. Reversing or
  // loosening either one moves the boundary and changes what was promised.
  assert.match(sql, /= CURRENT_DATE - v_sla/);
  assert.match(sql, /< CURRENT_DATE - v_sla/);
  assert.doesNotMatch(sql, /<= CURRENT_DATE - v_sla[\s\S]{0,40}AS days_waiting/);
});

test('the SQL counts from the report date, like everything else', () => {
  assert.match(sql, /COALESCE\(t\.reported_date, t\.created_at::date\)/);
});

test('only open jobs are watched', () => {
  assert.match(sql, /t\.status IN \('unassigned', 'assigned', 'in_progress', 'blocked'\)/);
});

test('a technician cannot read the watch list', () => {
  assert.match(sql, /IF v_caller\.role = 'technician' THEN\s*RAISE EXCEPTION/);
});

test('the migration does not change the promise', () => {
  // No ALTER, no UPDATE of any SLA setting, no edit to tasks.
  assert.doesNotMatch(sql, /ALTER TABLE|UPDATE public\.tasks/);
});
