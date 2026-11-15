import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOX_HISTORY_NOTE,
  FAULT_WINDOWS,
  attributedFaults,
  boxHistoryLabel,
  hasUnlinkedWork,
  rankedBoxes,
  type BoxFaultRow,
} from '../src/lib/boxHistory';

/**
 * A fault leaderboard is the easiest screen in this app to misquote: "box FAT48
 * has 12 faults" means nothing without a window, and means something false if
 * the faults that name no box were quietly dropped.
 */

const box = (over: Partial<BoxFaultRow> = {}): BoxFaultRow => ({
  box_id: over.box_id ?? over.box_code ?? 'b',
  box_code: over.box_code ?? 'B',
  xaafada: over.xaafada ?? null,
  health_status: over.health_status ?? null,
  faults: over.faults ?? 0,
  open_faults: over.open_faults ?? 0,
  last_fault_at: over.last_fault_at ?? null,
});

test('the worst box is first', () => {
  const ranked = rankedBoxes([
    box({ box_code: 'A', faults: 2 }),
    box({ box_code: 'C', faults: 9 }),
    box({ box_code: 'B', faults: 5 }),
  ]);

  assert.deepEqual(
    ranked.map((row) => row.box_code),
    ['C', 'B', 'A'],
  );
});

test('a box with no faults is not in the table', () => {
  // Twenty healthy boxes would bury the two that matter.
  const ranked = rankedBoxes([box({ box_code: 'OK', faults: 0 }), box({ box_code: 'BAD', faults: 1 })]);
  assert.deepEqual(
    ranked.map((row) => row.box_code),
    ['BAD'],
  );
});

test('equal faults break the tie by box code, not by query order', () => {
  // An unstable sort makes the same data look different on every load.
  const ranked = rankedBoxes([
    box({ box_code: 'Z', faults: 3 }),
    box({ box_code: 'A', faults: 3 }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.box_code),
    ['A', 'Z'],
  );
});

test('an empty history is an empty table, not a crash', () => {
  assert.deepEqual(rankedBoxes([]), []);
  assert.equal(attributedFaults([]), 0);
});

test('the total adds what is attributed, and nothing else', () => {
  const total = attributedFaults([
    box({ box_code: 'A', faults: 3 }),
    box({ box_code: 'B', faults: 4 }),
  ]);
  assert.equal(total, 7);
});

test('unlinked work is flagged, not swallowed', () => {
  // Measured on the live project: zero of eight tasks carried a box reference.
  // If the screen showed only the leaderboard, it would read as a complete
  // picture of a healthy estate while every fault was invisible.
  assert.equal(hasUnlinkedWork({ unassigned_faults: 0 }), false);
  assert.equal(hasUnlinkedWork({ unassigned_faults: 1 }), true);
  assert.equal(hasUnlinkedWork({ unassigned_faults: 12 }), true);
});

test('the heading always carries its window', () => {
  for (const days of FAULT_WINDOWS) {
    const en = boxHistoryLabel(days, 'en');
    assert.match(en, new RegExp(String(days)), 'the window is missing from the heading');
    assert.match(boxHistoryLabel(days, 'so'), new RegExp(String(days)));
  }
});

test('the windows are the three the plan promised', () => {
  assert.deepEqual([...FAULT_WINDOWS], [7, 30, 90]);
});

test('the note explains what is and is not counted', () => {
  // "12 faults" invites "so it is fixed now" and "so it is being fixed".
  assert.match(BOX_HISTORY_NOTE.en, /not fixed yet/i);
  assert.match(BOX_HISTORY_NOTE.en, /cancelled/i);
  assert.match(BOX_HISTORY_NOTE.so, /la tirtiray/i);
  assert.notEqual(BOX_HISTORY_NOTE.en, BOX_HISTORY_NOTE.so);
});

/* -------------------------------------------------------------------------- */
/* The query must match the claims the screen makes                            */
/* -------------------------------------------------------------------------- */

test('the window is applied to when a fault was reported, not completed', () => {
  // The plan said `completed_at`. That scores the worst box — five faults this
  // week, none fixed yet — at zero. The implementation must use reported date.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/027_box_fault_history.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /'basis',\s*'reported'/);
  assert.match(sql, /COALESCE\(t\.reported_date,\s*t\.created_at::date\)\s*>=\s*v_from/);
  assert.doesNotMatch(
    sql,
    /completed_at\s*>=\s*v_from/,
    'the window must not be applied to the completion time',
  );
});

test('cancelled faults are excluded and open faults are not', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/027_box_fault_history.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /t\.status <> 'cancelled'/);
  assert.match(sql, /open_faults/, 'faults still open must be counted separately, not excluded');
});

test('a box with no faults still comes back, with a zero', () => {
  // Required so the screen can say "2 boxes, no faults" instead of showing an
  // empty panel that looks like a loading failure.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/027_box_fault_history.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /FROM public\.cableboxes b\s*\n\s*LEFT JOIN/, 'boxes must be the driving side');
  assert.match(sql, /COALESCE\(f\.faults,\s*0\)/);
});

test('the lifetime counter is not used', () => {
  // `cableboxes.fault_count` cannot answer "this month" and cannot be reset.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/027_box_fault_history.sql', import.meta.url)),
    'utf8',
  );
  const query = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'), sql.indexOf('GRANT EXECUTE'));
  assert.doesNotMatch(query, /fault_count/, 'the lifetime counter cannot answer a windowed question');
});

test('the window is bounded so a caller cannot ask for a million days', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/027_box_fault_history.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /LEAST\(COALESCE\(p_days,\s*30\),\s*365\)/);
  assert.match(sql, /GREATEST\(1,/);
});
