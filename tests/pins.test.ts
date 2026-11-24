import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  clearDepartmentPins,
  flagPinsExplanation,
  lockedSentence,
  pinProblem,
  stalePinMembers,
  stalePinSentence,
} from '../src/lib/pins';

/**
 * Who is still on a PIN the department chose.
 *
 * The first version of this rule asked the wrong question. It treated anyone
 * whose `must_change_pin` was not true as still being on a department PIN — but
 * `false` is the *finished* state, the one a person reaches by choosing their
 * own. So it counted the people who had done the right thing, its only button
 * could not clear anything, and the banner on the Team screen could not be
 * dismissed by any action a supervisor could take.
 *
 * The live data on 24/11/2026 was the proof: the supervisor was the only
 * account with `must_change_pin = false`, and the banner said "1 person can
 * still sign in with the PIN the department set" about him — the one person who
 * had changed his.
 *
 * The rule now reads `seed_pin_flag`, which the database sets when a supervisor
 * issues a PIN and clears when the person replaces it. These tests hold both
 * halves: who counts, and the fact that the count can reach zero.
 */

const member = (over: Record<string, unknown> = {}) => ({
  full_name: 'Cabdiraxmaan Maxamed',
  role: 'technician',
  is_active: true,
  seed_pin_flag: true,
  must_change_pin: true,
  ...over,
});

test('pins: the flag decides, not the must-change state', () => {
  assert.equal(stalePinMembers([member()]).length, 1);
  assert.equal(stalePinMembers([member({ seed_pin_flag: false })]).length, 0);
});

test('pins: somebody who chose their own PIN is not on a department PIN', () => {
  // The exact live shape that made the banner permanent: changed PIN (flag
  // false), must_change already cleared. It must count as zero.
  const done = member({ seed_pin_flag: false, must_change_pin: false });
  assert.equal(stalePinMembers([done]).length, 0);
});

test('pins: inactive people and managers are not the supervisor\'s to flag', () => {
  assert.equal(stalePinMembers([member({ is_active: false })]).length, 0);
  assert.equal(stalePinMembers([member({ role: 'manager' })]).length, 0);
  assert.equal(stalePinMembers([member({ role: 'supervisor' })]).length, 1);
});

test('pins: the count reaches zero, which is the whole point', () => {
  const team = [
    member({ full_name: 'A', seed_pin_flag: true }),
    member({ full_name: 'B', seed_pin_flag: false }),
    member({ full_name: 'C', role: 'supervisor', seed_pin_flag: false }),
    member({ full_name: 'D', is_active: false, seed_pin_flag: true }),
  ];

  assert.deepEqual(
    stalePinMembers(team).map((row) => row.full_name),
    ['A'],
  );

  // Everybody chooses their own PIN; the banner has nothing left to say.
  const after = team.map((row) => ({ ...row, seed_pin_flag: false }));
  assert.equal(stalePinMembers(after).length, 0);
});

test('pins: the screen says it plainly in both languages', () => {
  assert.equal(stalePinSentence(0, 'en'), 'Everyone is using a PIN of their own.');
  assert.equal(stalePinSentence(1, 'en'), '1 person can still sign in with the PIN the department set.');
  assert.equal(stalePinSentence(4, 'en'), '4 people can still sign in with the PIN the department set.');
  assert.match(stalePinSentence(4, 'so'), /^4 qof/);
  assert.match(stalePinSentence(1, 'so'), /^1 qof/, 'Somali pluralises at one differently');
});

test('pins: the explanation no longer tells the supervisor to go elsewhere', () => {
  // The old copy ended "You will need to change your own too — from the header
  // menu", which was both a chore and, on this screen, unactionable. The
  // replacement describes what this page can actually do.
  const en = flagPinsExplanation('en');
  assert.doesNotMatch(en, /header menu/i);
  assert.match(en, /change anybody’s PIN from this page|choose one at their next sign-in/i);
  assert.match(flagPinsExplanation('so'), /PIN/);
});

test('pins: a PIN is four to six digits, and the form says so', () => {
  assert.equal(pinProblem('1234', 'en'), null);
  assert.equal(pinProblem('123456', 'en'), null);
  assert.match(pinProblem('123', 'en') ?? '', /4 to 6 digits/);
  assert.match(pinProblem('1234567', 'en') ?? '', /4 to 6 digits/);
  assert.match(pinProblem('12a4', 'en') ?? '', /4 to 6 digits/);
  assert.match(pinProblem('', 'en') ?? '', /No PIN/);
  assert.match(pinProblem('', 'so') ?? '', /PIN ma qoran/);
});

test('pins: a lockout is shown with the time it lifts', () => {
  const line = lockedSentence('2026-11-24T23:07:35.191562+00:00', 'en');
  assert.match(line, /Locked out until \d{2}:\d{2}/);
  assert.match(lockedSentence('2026-11-24T23:07:35Z', 'so'), /Wuu xiran yahay/);
  // Nonsense must not print "Invalid Date" at a supervisor.
  assert.equal(lockedSentence('not a date', 'en'), '');
});

test('pins: issuing a PIN clears the lock, and the SQL says so', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/035_pin_and_fault_type.sql', import.meta.url)),
    'utf8',
  );

  // The bug: a correct new hash on an account that still refused to sign in.
  assert.match(sql, /locked_until = NULL/);
  assert.match(sql, /failed_attempts = 0/);
  // Both flags move together, so the banner and the badge cannot disagree.
  assert.match(sql, /must_change_pin = true, seed_pin_flag = true/);
  assert.match(sql, /must_change_pin = false, seed_pin_flag = false/);
});

test('pins: the supervisor can flag and unflag, which is why it can clear', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/035_pin_and_fault_type.sql', import.meta.url)),
    'utf8',
  );

  // The old function could only ever set true, on rows already false.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_department_pin_flag/);
  assert.match(sql, /GET DIAGNOSTICS v_count = ROW_COUNT/);
  assert.match(sql, /v_caller\.role <> 'supervisor'/);
  assert.match(sql, /u\.group_id = v_caller\.group_id/);
  assert.match(sql, /u\.role IN \('supervisor', 'technician'\)/);
});

test('pins: the client has a way out that is not "press the same button again"', async () => {
  // `clearDepartmentPins` is the counterpart that never existed. Spelled out
  // here because its absence is what made the banner a one-way door.
  assert.equal(typeof clearDepartmentPins, 'function');

  const screen = readFileSync(
    fileURLToPath(new URL('../src/components/supervisor/TeamAndCrewManager.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(screen, /stalePinMembers\(members\)/);
  assert.match(screen, /clearDepartmentPins\(session\.token\)/, 'the banner needs an exit');
  assert.match(screen, /pinStatus\.locked/, 'a locked account must be visible');
  assert.match(screen, /setMemberPin\(\{/, 'a supervisor must be able to issue a PIN here');
  assert.match(screen, /pinMustChange/, 'a member still on a department PIN must be marked');

  // The text the user asked to be rid of.
  assert.doesNotMatch(screen, /You will need to change your own too/);
  assert.doesNotMatch(screen, /from the header menu/);
});
