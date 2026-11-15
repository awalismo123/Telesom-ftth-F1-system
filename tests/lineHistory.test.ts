import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HISTORY_NOTE,
  dbmLabel,
  hasHistory,
  historyLabel,
  jobTypeLabel,
  lastDbm,
  newestFirst,
  noHistoryCopy,
  noLineCopy,
  previousJobs,
  steadySignal,
  type HistoryJob,
  type LineHistory,
} from '../src/lib/lineHistory';

/**
 * A customer's history is the kind of screen where a mistake is remembered
 * personally: "you told me nobody had been here". The tests are about never
 * misrepresenting what happened.
 */

const job = (over: Partial<HistoryJob> = {}): HistoryJob => ({
  id: 't1',
  reported_date: '2026-11-10',
  sort_date: '2026-11-10',
  created_at: '2026-11-10T08:00:00Z',
  task_type: 'cilada',
  status: 'completed',
  optical_dbm: -22.5,
  xaafada: 'JIGJIGAYAR',
  cablebox_code_raw: 'FAT48',
  completion_notes: null,
  cancel_reason: null,
  technician: 'Mustafe Axmed Xuseen',
  is_current: false,
  ...over,
});

const history = (jobs: HistoryJob[]): LineHistory => ({
  line_number: '575373',
  found: jobs.length > 0,
  jobs,
  total: jobs.length,
});

/* -------------------------------------------------------------------------- */
/* The current job is never its own history                                    */
/* -------------------------------------------------------------------------- */

test('the job being viewed is excluded from its own history', () => {
  // Otherwise the top entry is always "this job", which tells a technician
  // nothing and pushes the real history off the screen.
  const h = history([
    job({ id: 'now', sort_date: '2026-11-15' }),
    job({ id: 'old', sort_date: '2026-11-01' }),
  ]);
  assert.deepEqual(
    previousJobs(h, 'now').map((row) => row.id),
    ['old'],
  );
});

test('excluding the current job keeps the rest in order', () => {
  const h = history([
    job({ id: 'a', sort_date: '2026-11-15' }),
    job({ id: 'b', sort_date: '2026-11-10' }),
    job({ id: 'c', sort_date: '2026-11-01' }),
  ]);
  assert.deepEqual(
    previousJobs(h, 'b').map((row) => row.id),
    ['a', 'c'],
  );
});

test('no history at all is an empty list, not a crash', () => {
  assert.deepEqual(previousJobs(null, 'x'), []);
  assert.deepEqual(previousJobs(undefined, 'x'), []);
  assert.deepEqual(previousJobs(history([]), 'x'), []);
});

/* -------------------------------------------------------------------------- */
/* Newest first                                                               */
/* -------------------------------------------------------------------------- */

test('history reads newest first', () => {
  const rows = [
    job({ id: 'c', sort_date: '2026-09-01' }),
    job({ id: 'a', sort_date: '2026-11-15' }),
    job({ id: 'b', sort_date: '2026-10-01' }),
  ];
  assert.deepEqual(
    newestFirst(rows).map((row) => row.id),
    ['a', 'b', 'c'],
  );
});

test('rows with no date fall to the end, not to 1970', () => {
  const rows = [
    job({ id: 'nodate', sort_date: null, created_at: '2026-11-15T08:00:00Z' }),
    job({ id: 'dated', sort_date: '2026-11-01' }),
  ];
  assert.deepEqual(
    newestFirst(rows).map((row) => row.id),
    ['dated', 'nodate'],
  );
});

test('sorting does not mutate the input', () => {
  const rows = [job({ id: 'a', sort_date: '2026-09-01' }), job({ id: 'b', sort_date: '2026-11-01' })];
  newestFirst(rows);
  assert.equal(rows[0].id, 'a');
});

/* -------------------------------------------------------------------------- */
/* Saying nothing, clearly                                                    */
/* -------------------------------------------------------------------------- */

test('a line with no history says so rather than showing an empty box', () => {
  // An empty box reads as a loading failure, and the technician waits for it.
  assert.equal(hasHistory([]), false);
  assert.match(noHistoryCopy('en'), /No earlier jobs/);
  assert.match(noHistoryCopy('so'), /ma jirto/);
});

test('a job with no line says that, which is a different sentence', () => {
  // "No history" and "cannot look it up" are different facts and must not share
  // one message.
  assert.notEqual(noLineCopy('en'), noHistoryCopy('en'));
  assert.match(noLineCopy('en'), /no line number/);
});

test('the heading counts the jobs and is translated', () => {
  assert.equal(historyLabel(1, 'en'), '1 earlier job');
  assert.equal(historyLabel(3, 'en'), '3 earlier jobs');
  assert.notEqual(historyLabel(3, 'en'), historyLabel(3, 'so'));
});

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

test('the latest reading is the one to compare against', () => {
  const rows = [
    job({ id: 'new', sort_date: '2026-11-15', optical_dbm: -19.2 }),
    job({ id: 'old', sort_date: '2026-09-01', optical_dbm: -27.0 }),
  ];
  assert.equal(lastDbm(rows), -19.2);
});

test('a job with no reading is skipped, not read as zero', () => {
  // Zero dBm is a perfect signal. Treating "not recorded" as 0 would tell a
  // technician the line is healthy.
  const rows = [
    job({ id: 'new', sort_date: '2026-11-15', optical_dbm: null }),
    job({ id: 'old', sort_date: '2026-09-01', optical_dbm: -27.0 }),
  ];
  assert.equal(lastDbm(rows), -27.0);
});

test('no readings at all is null', () => {
  assert.equal(lastDbm([job({ optical_dbm: null })]), null);
  assert.equal(lastDbm([]), null);
});

test('a steady weak signal is recognised', () => {
  // Two readings within 2 dB points at the drop or splitter rather than the
  // customer's equipment.
  const rows = [job({ optical_dbm: -24.0 }), job({ optical_dbm: -23.5 })];
  assert.deepEqual(steadySignal(rows), { readings: 2, spread: 0.5 });
});

test('a swinging signal is not called steady', () => {
  assert.equal(steadySignal([job({ optical_dbm: -18.0 }), job({ optical_dbm: -26.0 })]), null);
});

test('one reading is not enough to call anything steady', () => {
  assert.equal(steadySignal([job({ optical_dbm: -24.0 })]), null);
  assert.equal(steadySignal([]), null);
});

test('readings are formatted as dBm and never invented', () => {
  assert.equal(dbmLabel(-22.5, 'en'), '-22.5 dBm');
  assert.match(dbmLabel(null, 'en'), /not recorded/);
  assert.notEqual(dbmLabel(null, 'en'), dbmLabel(null, 'so'));
});

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

test('job types are translated', () => {
  assert.equal(jobTypeLabel('cilada', 'en'), 'Fault');
  assert.equal(jobTypeLabel('installation', 'en'), 'Installation');
  assert.notEqual(jobTypeLabel('cilada', 'en'), jobTypeLabel('cilada', 'so'));
});

test('an unknown job type is shown as-is rather than as a guess', () => {
  assert.equal(jobTypeLabel('relocation', 'en'), 'relocation');
});

test('the note says cancellations are included', () => {
  assert.match(HISTORY_NOTE.en, /cancellations/i);
  assert.notEqual(HISTORY_NOTE.en, HISTORY_NOTE.so);
});

/* -------------------------------------------------------------------------- */
/* The database must agree with the screen                                    */
/* -------------------------------------------------------------------------- */

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/030_line_history.sql', import.meta.url)),
  'utf8',
);

test('history is keyed on the line, never on the customer name', () => {
  assert.match(sql, /lower\(btrim\(COALESCE\(t\.line_number, ''\)\)\) = v_key/);
  assert.doesNotMatch(sql, /customer_name\s*=\s*/);
});

test('a blank line returns nothing rather than the whole group', () => {
  assert.match(sql, /IF v_key = '' THEN[\s\S]{0,200}'found', false/);
});

test('the carryover link is honoured in addition to the line', () => {
  assert.match(sql, /t\.previous_task_id/);
  assert.match(sql, /t\.id = v_prev/);
});

test('the current job is excluded in SQL as well as on screen', () => {
  assert.match(sql, /\(p_exclude_task_id IS NULL OR t\.id <> p_exclude_task_id\)/);
});

test('cancelled jobs are not filtered out of the history', () => {
  assert.doesNotMatch(sql, /status\s*<>\s*'cancelled'/);
});

test('the list is ordered newest first', () => {
  assert.match(sql, /ORDER BY sort_date DESC NULLS LAST, t\.created_at DESC/);
});
