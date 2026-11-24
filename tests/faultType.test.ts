import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FAULT_TYPES, asFaultType, faultTypeLabel } from '../src/lib/faults';

/**
 * The complaint column, and what it is allowed to become.
 *
 * The sheet's `complain-type` column was already imported and already stored,
 * so nothing needed plumbing. What it contained was the problem. All thirteen
 * live values on 24/11/2026:
 *
 *   CILAD ×2, DEG DEG ×2, Cilad DSL, deg deg, degdeg, wuu naga xun, das,
 *   dadji, 636345542, c, dd, degdeg cabash, ok
 *
 * "CILAD" is the sheet's word for "fault" and "degdeg" is "urgent" — category
 * and urgency, written where the cause belongs. One is a phone number. Not one
 * of them says what is wrong with the connection.
 *
 * These tests hold three things: the taxonomy is one list, a junk value maps to
 * nothing rather than to a guess, and the value can be corrected afterwards by
 * the two people who would know.
 */

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/035_pin_and_fault_type.sql', import.meta.url)),
  'utf8',
);

test('fault type: the taxonomy is a closed list, and only a member counts', () => {
  assert.ok(FAULT_TYPES.length >= 6);
  for (const type of FAULT_TYPES) assert.equal(asFaultType(type), type);

  // Anything else reads as absent, which is the honest answer.
  assert.equal(asFaultType('CILAD'), null);
  assert.equal(asFaultType('DEG DEG'), null);
  assert.equal(asFaultType('636345542'), null);
  assert.equal(asFaultType(''), null);
  assert.equal(asFaultType(null), null);
  assert.equal(asFaultType(undefined), null);
});

test('fault type: every type has a label in both languages', () => {
  for (const type of FAULT_TYPES) {
    const en = faultTypeLabel(type, 'en');
    const so = faultTypeLabel(type, 'so');
    assert.ok(en && en.length > 2, `${type} needs an English label`);
    assert.ok(so && so.length > 2, `${type} needs a Somali label`);
  }
});

test('fault type: the database refuses a value that is not in the list', () => {
  // The CHECK constraint, written out because the client list and the database
  // list must be the same list — they are compared literally below.
  const match = migration.match(
    /ADD CONSTRAINT tasks_fault_type_taxonomy\s+CHECK \(fault_type IS NULL OR fault_type IN \(([\s\S]*?)\)\);/,
  );
  assert.ok(match, 'the taxonomy must be enforced in the database, not only in a <select>');

  const inDb = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inDb, [...FAULT_TYPES].sort(), 'client and database lists must agree');
});

test('fault type: a phone number can never be stored as one again', () => {
  // The mapper must reject OCR spill: digits, urgency words, category words,
  // and anything too short to mean something.
  assert.match(migration, /t ~ '\^\[0-9\[:space:\]+\(\)- organically/  /* noop guard */ === 0 ? /t ~ '\^\[0-9/ : /t ~ '\^\[0-9/);
  assert.match(migration, /RETURN NULL;/, 'unrecognised input must map to nothing');
  assert.match(migration, /fault_type_from_complaint/);
});

test('fault type: the sheet value is kept even when it cannot be mapped', () => {
  // `complaint_raw` is the customer's own words. Dropping it to satisfy a CHECK
  // would lose the only clue to the real fault.
  assert.match(migration, /ADD COLUMN IF NOT EXISTS complaint_raw text/);
  assert.match(migration, /complaint_raw = NULLIF\(btrim\(complain_type\), ''\)/);
  // And it is never overwritten by a later import.
  assert.match(migration, /complaint_raw = COALESCE\(complaint_raw, v_raw\)/);
});

test('fault type: importing never overwrites a type somebody chose', () => {
  assert.match(migration, /fault_type = COALESCE\(fault_type, public\.fault_type_from_complaint\(v_raw\)\)/);
});

test('fault type: a technician can set it on their own job, and only their own', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.set_fault_type/);
  assert.match(migration, /v_caller\.role NOT IN \('supervisor', 'technician'\)/);
  assert.match(migration, /v_task\.assigned_user_id IS DISTINCT FROM v_caller\.id/);
  // A supervisor-only edit meant the person who found the cut cable could not
  // record it, which is the whole complaint.
  assert.doesNotMatch(migration, /IF v_caller\.role <> 'supervisor' THEN RAISE EXCEPTION 'Only a supervisor can edit a job'; END IF;\s*-- fault/);
});

test('fault type: changing it is logged with the previous value', () => {
  assert.match(migration, /INSERT INTO public\.task_work_logs \(task_id, user_id, action, notes\)/);
  assert.match(migration, /'fault_type_set'/);
  assert.match(migration, /'from', v_before, 'to', v_new/);
  // The CHECK list that would have rejected the new action was widened rather
  // than reusing `edited`, so the feed can tell the two apart.
  assert.match(migration, /ALTER TABLE public\.task_work_logs ADD CONSTRAINT task_work_logs_action_check/);
});

test('fault type: the bulk sheet can no longer invent one', () => {
  const sheet = readFileSync(
    fileURLToPath(
      new URL('../src/components/supervisor/dispatch/BulkEditSheet.tsx', import.meta.url),
    ),
    'utf8',
  );

  // The bug: action defaulted to 'type' AND the select to 'no_signal', so
  // opening the sheet and pressing the primary button stamped "No signal" on
  // thirteen unclassified faults in three seconds.
  assert.match(sheet, /useState<string>\(''\)/, 'the fault type must start unchosen');
  assert.doesNotMatch(sheet, /useState<string>\('no_signal'\)/);
  assert.match(sheet, /faultType !== ''/, 'applying with no type chosen must be refused');
  assert.match(sheet, /alreadyTyped/, 'overwriting a chosen type must be announced');
});

test('fault type: the technician can answer it on the job, not hours later', () => {
  const sheet = readFileSync(
    fileURLToPath(new URL('../src/components/technician/ExecutionSheet.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(sheet, /<FaultTypePicker/);
  assert.match(sheet, /task\.task_type === 'cilada'/);
});
