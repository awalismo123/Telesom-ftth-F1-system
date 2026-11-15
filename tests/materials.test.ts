import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMMON_ITEMS,
  MAX_QUANTITY,
  MATERIAL_PROBLEM_COPY,
  MATERIAL_UNITS,
  NO_STOCK_NOTE,
  UNIT_LABEL,
  USAGE_LABEL,
  formatQuantity,
  materialProblem,
  normaliseLine,
  usageByItem,
} from '../src/lib/materials';

/**
 * Two things are being protected here.
 *
 * 1. A quantity that cannot be true is rejected at the field, not at the
 *    database. A technician standing in a stairwell should not have to read a
 *    Postgres constraint name.
 * 2. Nothing in the interface may call a usage figure "stock". A stock number
 *    computed only from issues would drift from the shelf, and a supervisor
 *    would eventually reorder from it.
 */

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

test('a real line passes', () => {
  assert.equal(materialProblem({ item: 'Drop cable', quantity: 6, unit: 'm' }), null);
  assert.equal(materialProblem({ item: 'ONT / Router', quantity: 1, unit: 'pcs' }), null);
});

test('an item with no name is rejected', () => {
  assert.equal(materialProblem({ item: '', quantity: 1, unit: 'pcs' }), 'no-item');
  assert.equal(materialProblem({ item: '   ', quantity: 1, unit: 'pcs' }), 'no-item');
  assert.equal(materialProblem({ quantity: 1, unit: 'pcs' }), 'no-item');
});

test('zero and negative quantities are rejected', () => {
  // "0 metres of drop cable" is not a record of anything, and a negative one is
  // a subtraction nobody asked for.
  assert.equal(materialProblem({ item: 'Drop cable', quantity: 0, unit: 'm' }), 'bad-quantity');
  assert.equal(materialProblem({ item: 'Drop cable', quantity: -6, unit: 'm' }), 'bad-quantity');
});

test('a non-number is rejected rather than coerced', () => {
  // `parseFloat('6abc')` is 6 — silently accepting that is how a typo becomes a
  // number nobody questions.
  assert.equal(materialProblem({ item: 'Drop cable', quantity: NaN, unit: 'm' }), 'bad-quantity');
  assert.equal(
    materialProblem({ item: 'Drop cable', quantity: '6' as unknown as number, unit: 'm' }),
    'bad-quantity',
  );
});

test('an absurd quantity is rejected as a slipped decimal', () => {
  assert.equal(materialProblem({ item: 'Cable tie', quantity: MAX_QUANTITY + 1, unit: 'pcs' }), 'bad-quantity');
  assert.equal(materialProblem({ item: 'Cable tie', quantity: MAX_QUANTITY, unit: 'pcs' }), null);
});

test('a fractional quantity is allowed, because cable is cut', () => {
  assert.equal(materialProblem({ item: 'Drop cable', quantity: 6.5, unit: 'm' }), null);
});

test('an unknown unit is rejected', () => {
  assert.equal(
    materialProblem({ item: 'Drop cable', quantity: 6, unit: 'furlong' as never }),
    'not-a-unit',
  );
});

test('every rejection is translated and explains itself', () => {
  for (const [problem, copy] of Object.entries(MATERIAL_PROBLEM_COPY)) {
    assert.ok(copy.en.length > 5, `${problem} has no English copy`);
    assert.ok(copy.so.length > 5, `${problem} has no Somali copy`);
    assert.notEqual(copy.en, copy.so, `${problem} is not translated`);
  }
});

test('the problems the validator can return all have copy', () => {
  const produced = [
    materialProblem({ item: '', quantity: 1 }),
    materialProblem({ item: 'x', quantity: 0 }),
    materialProblem({ item: 'x'.repeat(200), quantity: 1 }),
    materialProblem({ item: 'x', quantity: 1, unit: 'parsec' as never }),
  ];

  for (const problem of produced) {
    assert.ok(problem, 'expected a rejection');
    assert.ok(MATERIAL_PROBLEM_COPY[problem], `no copy for "${problem}"`);
  }
});

/* -------------------------------------------------------------------------- */
/* Normalising                                                                 */
/* -------------------------------------------------------------------------- */

test('a saved line is tidy', () => {
  assert.deepEqual(normaliseLine({ item: '  Drop   cable ', quantity: 6, unit: 'm' }), {
    item: 'Drop cable',
    quantity: 6,
    unit: 'm',
  });
});

test('quantities are stored to two decimals at most', () => {
  // Floating-point noise from a fraction is not a measurement.
  assert.equal(normaliseLine({ item: 'x', quantity: 6.666666, unit: 'm' }).quantity, 6.67);
});

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

test('quantities of the same item and unit are added', () => {
  const rows = usageByItem([
    { item: 'Drop cable', quantity: 6, unit: 'm' },
    { item: 'Drop cable', quantity: 4, unit: 'm' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].jobs, 2);
});

test('the same item in different units stays separate', () => {
  // 6 metres of cable and 6 connectors cannot be added. Merging them would
  // produce a number that means nothing and looks authoritative.
  const rows = usageByItem([
    { item: 'Connector', quantity: 6, unit: 'm' },
    { item: 'Connector', quantity: 2, unit: 'pcs' },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => `${r.quantity}${r.unit}`).sort(),
    ['2pcs', '6m'],
  );
});

test('the biggest usage is listed first', () => {
  const rows = usageByItem([
    { item: 'Cable tie', quantity: 3, unit: 'pcs' },
    { item: 'Drop cable', quantity: 40, unit: 'm' },
    { item: 'Patch cord (SC/APC)', quantity: 1, unit: 'pcs' },
  ]);

  assert.deepEqual(
    rows.map((r) => r.item),
    ['Drop cable', 'Cable tie', 'Patch cord (SC/APC)'],
  );
});

test('an empty list is an empty summary, not a crash', () => {
  assert.deepEqual(usageByItem([]), []);
});

test('totals carry the job count, which a sum alone hides', () => {
  // One job using three connectors is a different problem from three jobs using
  // one each, and the department reorders differently for each.
  const rows = usageByItem([
    { item: 'Fast connector', quantity: 3, unit: 'pcs' },
    { item: 'Fast connector', quantity: 1, unit: 'pcs' },
    { item: 'Fast connector', quantity: 1, unit: 'pcs' },
  ]);

  assert.equal(rows[0].jobs, 3);
  assert.equal(rows[0].quantity, 5);
});

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

test('a whole number reads without decimals', () => {
  assert.equal(formatQuantity(6, 'm', 'en'), '6 m');
  assert.equal(formatQuantity(1, 'pcs', 'en'), '1 pcs');
  assert.equal(formatQuantity(2, 'box', 'so'), '2 sanduuq');
});

test('a fraction keeps its precision', () => {
  assert.equal(formatQuantity(6.5, 'm', 'en'), '6.5 m');
  assert.equal(formatQuantity(0.25, 'roll', 'en'), '0.25 roll');
});

test('every unit is labelled in both languages', () => {
  for (const unit of MATERIAL_UNITS) {
    assert.ok(UNIT_LABEL[unit].en.length > 0);
    assert.ok(UNIT_LABEL[unit].so.length > 0);
  }
});

test('the common items are the trade names, not translations', () => {
  // The store, the sheet and the technician all say "ONT" and "patch cord".
  // Translating them would create three names for one object.
  assert.ok(COMMON_ITEMS.includes('ONT / Router'));
  assert.ok(COMMON_ITEMS.includes('Patch cord (SC/APC)'));
  assert.ok(COMMON_ITEMS.length >= 5 && COMMON_ITEMS.length <= 12, 'a long list needs maintaining');
});

/* -------------------------------------------------------------------------- */
/* Usage, never stock                                                          */
/* -------------------------------------------------------------------------- */

test('the report calls itself usage', () => {
  assert.match(USAGE_LABEL.en, /used/i);
  assert.match(USAGE_LABEL.so, /isticmaalay/i);
  assert.doesNotMatch(USAGE_LABEL.en, /stock|remaining|on hand/i);
});

test('the screen says stock is not tracked', () => {
  // Without this sentence, an empty "stock" expectation becomes a bug report.
  assert.match(NO_STOCK_NOTE.en, /not tracked/i);
  assert.match(NO_STOCK_NOTE.en, /what was used, not what is left/i);
  assert.match(NO_STOCK_NOTE.so, /lama tirinayo/i);
});

test('the materials module never claims to know a stock level', () => {
  // If a `stock` or `remaining` concept is ever added here without a deliveries
  // table behind it, this fails — and that is the point.
  const source = readFileSync(
    fileURLToPath(new URL('../src/lib/materials.ts', import.meta.url)),
    'utf8',
  );

  // Comments are stripped first: the module's own explanation of this limit
  // contains the word "received", and the first version of this test matched it.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.doesNotMatch(code, /stockOnHand|remainingStock|stockLevel/i);
  assert.doesNotMatch(
    code,
    /received/i,
    'nothing records deliveries, so no code may subtract them',
  );
});

/* -------------------------------------------------------------------------- */
/* The database agrees with the client                                        */
/* -------------------------------------------------------------------------- */

test('the migration enforces the same rules the client does', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/026_materials.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /CHECK\s*\(\s*quantity\s*>\s*0/i, 'a zero quantity must be rejected');
  assert.match(
    sql,
    /length\(btrim\(item\)\)\s*BETWEEN\s*1\s*AND/i,
    'an empty or enormous item name must be rejected',
  );
  assert.match(sql, /CHECK\s*\(\s*unit\s+IN\s*\(/i, 'the unit must be one of the known ones');
});

test('the materials table is locked behind token-checked functions', () => {
  // Same posture as task_photos: the browser has the anon key, so a table with
  // RLS off would be readable by anyone who found the project URL.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/026_materials.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.task_materials FROM anon, authenticated/);
  assert.match(sql, /get_session_user\(p_token\)/, 'every function must check the session token');
});
