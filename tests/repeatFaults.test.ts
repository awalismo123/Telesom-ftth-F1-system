import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  REPEAT_NOTE,
  REPEAT_THRESHOLD,
  REPEAT_WINDOW_DAYS,
  evidenceLine,
  faultHistoryCopy,
  investigateCopy,
  needsInvestigation,
  rankedRepeatLines,
  repeatWatchLabel,
  type RepeatCount,
  type RepeatLine,
} from '../src/lib/repeatFaults';

/**
 * "Repeat fault" is the most accusatory label this app can put on a customer.
 * If it is wrong, a supervisor walks into a house believing the person is a
 * nuisance. These tests are mostly about **when not to say it**.
 */

const line = (over: Partial<RepeatLine> = {}): RepeatLine => ({
  line_number: '575373',
  customer_name: 'Cabdi Xasan',
  customer_phone: '0634111111',
  xaafada: 'JIGJIGAYAR',
  cablebox_code: 'FAT48',
  faults: 3,
  open_faults: 0,
  last_fault_at: '2026-11-14',
  flagged_repeats: 0,
  ...over,
});

const count = (over: Partial<RepeatCount> = {}): RepeatCount => ({
  line_number: '575373',
  faults: 3,
  threshold: 3,
  days: 90,
  from: '2026-08-18',
  to: '2026-11-15',
  investigate: true,
  known: true,
  jobs: [],
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The threshold                                                               */
/* -------------------------------------------------------------------------- */

test('the rule is three faults in ninety days', () => {
  assert.equal(REPEAT_THRESHOLD, 3);
  assert.equal(REPEAT_WINDOW_DAYS, 90);
});

test('two faults do not escalate', () => {
  assert.equal(needsInvestigation(count({ faults: 2 })), false);
});

test('three faults escalate', () => {
  assert.equal(needsInvestigation(count({ faults: 3 })), true);
});

test('more than three escalate', () => {
  assert.equal(needsInvestigation(count({ faults: 9 })), true);
});

test('the count is measured against the threshold the server sent, not a constant', () => {
  // If the department ever raises the bar, the screens follow the server rather
  // than disagreeing with it.
  assert.equal(needsInvestigation(count({ faults: 4, threshold: 5 })), false);
  assert.equal(needsInvestigation(count({ faults: 5, threshold: 5 })), true);
});

/* -------------------------------------------------------------------------- */
/* Never accuse without evidence                                               */
/* -------------------------------------------------------------------------- */

test('a job with no line number is never escalated', () => {
  // The single worst false positive available: every unattributable job would
  // otherwise look like one extremely unlucky customer.
  assert.equal(needsInvestigation(count({ known: false, faults: 12 })), false);
});

test('no data at all is not an accusation', () => {
  assert.equal(needsInvestigation(null), false);
  assert.equal(needsInvestigation(undefined), false);
});

test('the note refuses the phone-number reading explicitly', () => {
  // Two customers can share a phone — a shop, a family, a borrowed handset.
  assert.match(REPEAT_NOTE.en, /same phone number is never treated as the same customer/i);
  assert.match(REPEAT_NOTE.so, /lambarka taleefanka isku mid ahna looma qaato macmiil isku mid ah/i);
});

test('the note says what is excluded', () => {
  assert.match(REPEAT_NOTE.en, /cancelled/i);
  assert.notEqual(REPEAT_NOTE.en, REPEAT_NOTE.so);
});

/* -------------------------------------------------------------------------- */
/* The heading carries its window                                              */
/* -------------------------------------------------------------------------- */

test('the heading always says the window', () => {
  // "3 faults" without "in 90 days" is the kind of number that gets quoted in a
  // meeting and remembered wrongly.
  for (const days of [7, 30, 90]) {
    assert.match(repeatWatchLabel(days, 'en'), new RegExp(String(days)));
    assert.match(repeatWatchLabel(days, 'so'), new RegExp(String(days)));
  }
  assert.notEqual(repeatWatchLabel(90, 'en'), repeatWatchLabel(90, 'so'));
});

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

test('the worst line is first', () => {
  const ranked = rankedRepeatLines([
    line({ line_number: 'A', faults: 3 }),
    line({ line_number: 'B', faults: 7 }),
    line({ line_number: 'C', faults: 4 }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.line_number),
    ['B', 'C', 'A'],
  );
});

test('equal counts break the tie by the most recent fault', () => {
  const ranked = rankedRepeatLines([
    line({ line_number: 'OLD', faults: 3, last_fault_at: '2026-09-01' }),
    line({ line_number: 'NEW', faults: 3, last_fault_at: '2026-11-14' }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.line_number),
    ['NEW', 'OLD'],
  );
});

test('ranking does not mutate its input', () => {
  const input = [line({ line_number: 'A', faults: 1 }), line({ line_number: 'B', faults: 9 })];
  const before = input.map((row) => row.line_number);
  rankedRepeatLines(input);
  assert.deepEqual(
    input.map((row) => row.line_number),
    before,
  );
});

test('an empty watch list is an empty list, not a crash', () => {
  assert.deepEqual(rankedRepeatLines([]), []);
});

/* -------------------------------------------------------------------------- */
/* Evidence is shown, never counted                                            */
/* -------------------------------------------------------------------------- */

test('no evidence line is printed when there is none', () => {
  // "0 of these were already flagged as returns" reads like a contradiction.
  assert.equal(evidenceLine(line({ flagged_repeats: 0, faults: 3 }), 'en'), null);
});

test('the evidence is shown as a fraction of the total', () => {
  // Not as the count itself: those two numbers are different and the difference
  // is the whole reason this feature does not use the flag as its trigger.
  const text = evidenceLine(line({ flagged_repeats: 2, faults: 3 }), 'en');
  assert.match(text!, /2\/3/);
  assert.doesNotMatch(text!, /^2 /, 'the evidence must not read as the fault count');
});

test('the evidence is translated', () => {
  const en = evidenceLine(line({ flagged_repeats: 2, faults: 3 }), 'en');
  const so = evidenceLine(line({ flagged_repeats: 2, faults: 3 }), 'so');
  assert.notEqual(en, so);
});

/* -------------------------------------------------------------------------- */
/* Job-sheet copy                                                              */
/* -------------------------------------------------------------------------- */

test('the job sheet says "worth investigating", not "repeat offender"', () => {
  // The word "repeat" on a technician's screen is one step from a judgement
  // about the person living there.
  const text = investigateCopy(3, 90, 'en');
  assert.match(text, /worth investigating/i);
  assert.doesNotMatch(text, /bad customer|offender|abuser/i);
});

test('the copy names the count and the window together', () => {
  for (const lang of ['en', 'so'] as const) {
    const text = investigateCopy(4, 90, lang);
    assert.match(text, /4/);
    assert.match(text, /90/);
  }
});

test('one fault is singular in both languages', () => {
  assert.equal(faultHistoryCopy(1, 90, 'en'), '1 fault in 90 days');
  assert.match(faultHistoryCopy(1, 90, 'so'), /^1 cilad /);
});

test('several faults are plural', () => {
  assert.equal(faultHistoryCopy(3, 90, 'en'), '3 faults in 90 days');
  assert.match(faultHistoryCopy(3, 90, 'so'), /^3 ciladood /);
});

/* -------------------------------------------------------------------------- */
/* The database must count what the screen claims to count                     */
/* -------------------------------------------------------------------------- */

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/028_repeat_faults.sql', import.meta.url)),
  'utf8',
);

test('the count is of fault jobs, not of the importer flag', () => {
  // See the migration header: the flag is set only for a line returning after a
  // COMPLETED job, so three real faults produce two flags. A rule built on the
  // flag needs a fourth fault and depends on import timing.
  assert.match(sql, /count\(\*\) AS faults/);
  assert.match(sql, /HAVING count\(\*\) >= v_threshold/);
  assert.match(
    sql,
    /count\(\*\) FILTER \(WHERE t\.is_repeat_fault OR t\.previous_task_id IS NOT NULL\) AS flagged_repeats/,
    'the flag must be reported as evidence beside the count',
  );
  assert.doesNotMatch(
    sql,
    /HAVING count\(\*\) FILTER[\s\S]{0,80}>= v_threshold/,
    'the threshold must not be applied to the flagged subset',
  );
});

test('only fault jobs count, and cancelled ones do not', () => {
  assert.match(sql, /t\.task_type = 'cilada'/);
  assert.match(sql, /t\.status <> 'cancelled'/);
});

test('an empty line number is never grouped with another', () => {
  // The worst false positive available: every anonymous job becoming one
  // customer with a serial fault.
  assert.match(sql, /btrim\(COALESCE\(t\.line_number, ''\)\) <> ''/);
});

test('the window is applied to the report date', () => {
  assert.match(sql, /COALESCE\(t\.reported_date, t\.created_at::date\) >= v_from/);
  assert.doesNotMatch(sql, /completed_at\s*>=\s*v_from/);
});

test('the server sorts faults as numbers, not as text', () => {
  // Caught in review: `row->>'faults'` is text, and sorting text puts "10"
  // before "9". A line with ten faults would have ranked below one with nine.
  assert.match(sql, /ORDER BY \(row->>'faults'\)::int DESC/);
  assert.doesNotMatch(
    sql,
    /ORDER BY row->>'faults' DESC/,
    'the faults key is text and must be cast before ordering',
  );
});

test('the threshold cannot be set low enough to flag every job', () => {
  // A threshold of 1 is the job list, not an escalation.
  assert.match(sql, /GREATEST\(2, LEAST\(COALESCE\(p_threshold, 3\), 20\)\)/);
});

test('a job with no line number returns known = false rather than a guess', () => {
  assert.match(sql, /'known', false/);
  assert.match(sql, /IF v_key = '' THEN/);
});

test('both functions check the session token', () => {
  assert.match(sql, /get_session_user\(p_token\)/g);
  assert.match(sql, /public\.get_task\(p_token, p_task_id\)/);
});
