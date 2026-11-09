import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { flagPinsWarning, stalePinMembers, stalePinSentence } from '../src/lib/pins';

/**
 * The rule that was never applied.
 *
 * Batch B promised that a department-issued PIN must be replaced at sign-in.
 * Nothing set the flag on the accounts that already existed, so every seeded
 * account — including the supervisor — could sign in with the PIN printed in the
 * README. These tests hold the two halves of the fix: who counts as still on a
 * department PIN, and what the screen says about it.
 */

const member = (over: Partial<Parameters<typeof stalePinMembers>[0][number]> = {}) => ({
  full_name: 'Cabdiraxmaan Maxamed',
  role: 'technician',
  is_active: true,
  must_change_pin: false,
  ...over,
});

test('pins: an active person without the flag is still on a department PIN', () => {
  assert.equal(stalePinMembers([member()]).length, 1);
  assert.equal(stalePinMembers([member({ must_change_pin: true })]).length, 0);
});

test('pins: inactive people and managers are not the supervisor\'s to flag', () => {
  assert.equal(stalePinMembers([member({ is_active: false })]).length, 0);
  assert.equal(stalePinMembers([member({ role: 'manager' })]).length, 0);
  assert.equal(stalePinMembers([member({ role: 'supervisor' })]).length, 1);
});

test('pins: the count matches what the button would do', () => {
  const team = [
    member({ full_name: 'A' }),
    member({ full_name: 'B', must_change_pin: true }),
    member({ full_name: 'C', role: 'supervisor' }),
    member({ full_name: 'D', is_active: false }),
  ];
  assert.deepEqual(
    stalePinMembers(team).map((row) => row.full_name),
    ['A', 'C'],
  );
});

test('pins: the screen says it plainly in both languages', () => {
  assert.equal(stalePinSentence(0, 'en'), 'Everyone is using a PIN of their own.');
  assert.equal(stalePinSentence(1, 'en'), '1 person can still sign in with the PIN the department set.');
  assert.equal(stalePinSentence(4, 'en'), '4 people can still sign in with the PIN the department set.');
  assert.match(stalePinSentence(4, 'so'), /^4 qof/);
  assert.match(flagPinsWarning('so'), /PIN cusub/);
  assert.match(flagPinsWarning('en'), /change your own too/);
});

test('pins: the flag is a supervisor action, and the SQL enforces it', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/016_batch_h_pin_policy.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /v_caller\.role <> 'supervisor'/);
  assert.match(sql, /SET must_change_pin = true/);
  // Only the group's own staff — never another group, never a manager.
  assert.match(sql, /u\.group_id = v_caller\.group_id/);
  assert.match(sql, /u\.role IN \('supervisor', 'technician'\)/);
  assert.match(sql, /GET DIAGNOSTICS v_count = ROW_COUNT/);
});

test('pins: the supervisor can see and press it on the Team screen', () => {
  const screen = readFileSync(
    fileURLToPath(new URL('../src/components/supervisor/TeamAndCrewManager.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(screen, /stalePinMembers\(members\)/);
  assert.match(screen, /flagDepartmentPins\(session\.token\)/);
  assert.match(screen, /pinMustChange/, 'a member still on a department PIN must be marked');
});
