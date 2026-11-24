import test from 'node:test';
import assert from 'node:assert/strict';

import { findInSheetRepeats } from '../src/lib/importer';

/**
 * Duplicates *within one sheet*.
 *
 * ## Why this file exists
 *
 * On 24/11/2026 a fault sheet was pasted into the wizard and imported. It
 * contained line **575666** twice — same customer, same date, same batch — and
 * the import created **two installation jobs** for it. The batch summary said
 * "0 duplicates", which was true against the database and false against the
 * sheet.
 *
 * The consequence is not cosmetic. Two jobs for one line means two technicians
 * can be dispatched to one address, and the customer is called twice about one
 * visit. The dedupe that missed it only compared incoming rows against what was
 * already stored; the first copy of a row is not stored yet when the second copy
 * is checked.
 */
test('the live failure: a line listed twice is caught the second time', () => {
  // The exact shape of the 24/11 sheet: 575666 appears at positions 7 and 8.
  const sheet = [
    '531970',
    '575489',
    '575491',
    '575493',
    '575494',
    '575495',
    '575666',
    '575666',
    '583248',
  ];

  const { indices, lines } = findInSheetRepeats(sheet);

  assert.deepEqual([...indices], [7], 'the second copy is the one skipped');
  assert.deepEqual(lines, ['575666']);
  assert.equal(sheet.length - indices.size, 8, 'eight jobs, not nine');
});

test('the earlier row is kept, not the later one', () => {
  // Dropping the first would also produce one job, but it would be the row the
  // supervisor read second. Keeping the first appearance makes the plan stable
  // when rows are re-ordered.
  const { indices } = findInSheetRepeats(['A1', 'A1', 'A2']);
  assert.equal(indices.has(0), false, 'the first occurrence survives');
  assert.equal(indices.has(1), true);
});

test('a line listed three times yields two skips and one job', () => {
  const { indices, lines } = findInSheetRepeats(['575666', '575666', '575666']);
  assert.equal(indices.size, 2);
  assert.deepEqual(lines, ['575666']);
});

test('distinct lines are never touched', () => {
  const { indices, lines } = findInSheetRepeats(['573864', '575463', '583123']);
  assert.equal(indices.size, 0);
  assert.deepEqual(lines, []);
});

test('blank line numbers are not treated as repeats of each other', () => {
  // Several unreadable rows are several problems. Collapsing them into one
  // "duplicate" would hide how much of the sheet could not be read.
  const { indices } = findInSheetRepeats([null, '', undefined, '   ']);
  assert.equal(indices.size, 0);
});

test('surrounding whitespace does not hide a repeat', () => {
  // OCR and pasted tables both produce trailing spaces. `575666 ` and `575666`
  // are the same customer.
  const { indices, lines } = findInSheetRepeats(['575666', ' 575666 ']);
  assert.deepEqual([...indices], [1]);
  assert.deepEqual(lines, ['575666']);
});

test('the returned line list is de-duplicated', () => {
  // The message a supervisor reads says which lines repeated. Listing 575666
  // three times because it appeared four times would be noise.
  const { lines } = findInSheetRepeats(['A1', 'A1', 'A1', 'A1']);
  assert.deepEqual(lines, ['A1']);
});

test('an empty sheet is handled without inventing anything', () => {
  const { indices, lines } = findInSheetRepeats([]);
  assert.equal(indices.size, 0);
  assert.deepEqual(lines, []);
});
