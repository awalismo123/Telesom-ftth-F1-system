import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  capacityCounts,
  capacitySentence,
  crewRetirementProblem,
  retirementProblem,
  workloadLine,
  type HeldJob,
} from '../src/lib/roster';

/**
 * Taking somebody off duty.
 *
 * The bug: `dispatch_load` builds the board from active technicians and active
 * crews only. Deactivating a person or retiring a crew therefore removed their
 * open jobs from every lane while leaving them `assigned` in the database. The
 * work was neither done nor visibly outstanding.
 *
 * Verified live on 24/11/2026: a technician with 2 open jobs deactivated
 * silently, and so did a crew with 2.
 */

const job = (over: Partial<HeldJob> = {}): HeldJob => ({
  id: 'j1',
  line_number: '573864',
  customer_name: 'CABDI XASAN',
  status: 'assigned',
  ...over,
});

test('somebody with no open work can go off duty', () => {
  const check = retirementProblem([]);
  assert.equal(check.ok, true);
  assert.equal(check.problem, null);
  assert.deepEqual(check.jobs, []);
  assert.equal(check.message, null);
});

test('the live failure: two assigned jobs block retirement', () => {
  const check = retirementProblem([job({ id: 'a' }), job({ id: 'b', line_number: '575463' })]);
  assert.equal(check.ok, false);
  assert.equal(check.problem, 'open-jobs');
  assert.equal(check.jobs.length, 2);
  assert.match(check.message!.en, /^2 jobs are still assigned here/);
  assert.match(check.message!.so, /2 shaqo ayaa weli halkan/);
});

test('one job is phrased as one job, not "1 jobs"', () => {
  const check = retirementProblem([job()]);
  assert.match(check.message!.en, /^One job is still assigned here/);
  assert.match(check.message!.so, /^Hal shaqo ayaa weli halkan/);
  assert.doesNotMatch(check.message!.en, /1 jobs/);
});

test('a job in progress gets its own, harder sentence', () => {
  // Somebody is standing at the customer's house. The difference matters: an
  // assigned job can be moved quietly, a job in progress cannot.
  const check = retirementProblem([job({ status: 'in_progress' })]);
  assert.equal(check.problem, 'active-job');
  assert.match(check.message!.en, /being worked on right now/);
  assert.match(check.message!.so, /hadda waa la shaqeynayaa/);
});

test('a blocked job counts as active work in hand', () => {
  // A blocked job is not idle: it is somebody who went out, found a problem and
  // is coming back. Retiring them drops that off the board just the same.
  const check = retirementProblem([job({ status: 'blocked' })]);
  assert.equal(check.problem, 'active-job');
});

test('an explicitly-declared active job wins over the status scan', () => {
  // The caller may know something the row does not — a running timer with a
  // stale status, for instance.
  const check = retirementProblem([job({ status: 'assigned' })], true);
  assert.equal(check.problem, 'active-job');
});

test('the blocked jobs are handed back so the screen can name them', () => {
  // A refusal that does not say *which* jobs leaves the supervisor hunting.
  const jobs = [job({ id: 'a', line_number: '573864' }), job({ id: 'b', line_number: '575463' })];
  const check = retirementProblem(jobs);
  assert.deepEqual(
    check.jobs.map((row) => row.line_number),
    ['573864', '575463'],
  );
});

test('the check does not mutate the list it was given', () => {
  const jobs = [job()];
  const before = [...jobs];
  retirementProblem(jobs);
  assert.deepEqual(jobs, before);
});

test('a crew is judged by exactly the same rule as a person', () => {
  const jobs = [job({ id: 'a' })];
  assert.deepEqual(crewRetirementProblem(jobs), retirementProblem(jobs));
  assert.equal(crewRetirementProblem([]).ok, true);
});

// --- the numbers on the roster -------------------------------------------------

test('workload is omitted entirely when there is none', () => {
  // A card that says "0 jobs" on every row is noise; absence is the statement.
  assert.equal(workloadLine(0, 0, 'en'), null);
  assert.equal(workloadLine(0, 3, 'en'), null, 'active_jobs alone cannot happen, but must not print');
});

test('workload counts open jobs, and names the ones in flight', () => {
  assert.equal(workloadLine(3, 0, 'en'), '3 open');
  assert.equal(workloadLine(3, 1, 'en'), '3 open · 1 in progress');
  assert.equal(workloadLine(3, 1, 'so'), '3 furan · 1 socda');
  assert.equal(workloadLine(1, 0, 'so'), '1 furan');
});

test('capacity does not double-count people inside crews', () => {
  // The live roster: 2 crews of 2, no lone technicians, and `dispatch_load`
  // lists 6 targets. The department has 2 units of capacity.
  const line = capacitySentence(2, 0, 'en');
  assert.match(line, /2 crews/);
  assert.match(line, /2 real units of capacity/);
  assert.doesNotMatch(line, /6/);
});

test('lone technicians add to capacity, and are named', () => {
  assert.match(capacitySentence(2, 1, 'en'), /2 crews and 1 lone technician — 3 real units/);
  assert.match(capacitySentence(1, 0, 'en'), /^1 crew — 1 real unit of capacity\.$/);
  assert.match(capacitySentence(0, 2, 'so'), /0 kooxo iyo 2 farsamayaqaan keligood ah/);
});

// --- the rule is enforced where it can be -------------------------------------------------

test('the database refuses retirement, not just the screen', () => {
  // A client-side check alone is a suggestion: the function is the authority and
  // is what another supervisor's stale tab will call.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/034_roster_and_crew_health.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /FUNCTION public\.upsert_team_member/, 'the member path must be guarded');
  assert.match(sql, /FUNCTION public\.upsert_crew/, 'the crew path must be guarded');
  assert.match(sql, /is_active[\s\S]{0,80}false|p_is_active[\s\S]{0,40}false/, 'the guard is about deactivation');

  // And the guard must look at the jobs that would disappear from the board.
  assert.match(sql, /assigned_user_id = p_member_id/, 'the member guard counts their jobs');
  assert.match(sql, /assigned_crew_id = p_crew_id/, 'the crew guard counts the crew\u2019s jobs');
  assert.match(sql, /'in_progress'/, 'and a job in flight is named as such');
});

test('the page asks the rule before it saves', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../src/components/supervisor/TeamAndCrewManager.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(page, /retirementProblem/, 'the member path must consult the rule');
  assert.match(page, /crewRetirementProblem/, 'the crew path must consult the rule too');
});

test('the workload numbers the rule needs are actually loaded', () => {
  // Without this the rule would be asked about an empty list and always pass —
  // the exact failure mode that makes a guard worthless while looking present.
  const page = readFileSync(
    fileURLToPath(new URL('../src/components/supervisor/TeamAndCrewManager.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(page, /fetchTeamWorkload|team_workload/, 'the page must fetch held jobs');
});

// --- capacity counting ---------------------------------------------------------

test('two crews of two are two units, not six', () => {
  // The live roster on 24/11/2026 — and `dispatch_load` lists 6 lanes for it.
  const crews = [
    { id: 'a', is_active: true },
    { id: 'b', is_active: true },
  ];
  const technicians = [
    { id: 't1', is_active: true },
    { id: 't2', is_active: true },
    { id: 't3', is_active: true },
    { id: 't4', is_active: true },
  ];
  const links = [
    { crew_id: 'a', user_id: 't1' },
    { crew_id: 'a', user_id: 't2' },
    { crew_id: 'b', user_id: 't3' },
    { crew_id: 'b', user_id: 't4' },
  ];

  const counts = capacityCounts(crews, technicians, links);
  assert.equal(counts.crewsWithMembers, 2);
  assert.equal(counts.loneTechnicians, 0, 'nobody is outside a crew');
  assert.match(capacitySentence(counts.crewsWithMembers, counts.loneTechnicians, 'en'), /2 real units/);
});

test('a technician outside every crew is their own unit', () => {
  const counts = capacityCounts(
    [{ id: 'a', is_active: true }],
    [
      { id: 't1', is_active: true },
      { id: 'float', is_active: true },
    ],
    [{ crew_id: 'a', user_id: 't1' }],
  );
  assert.equal(counts.crewsWithMembers, 1);
  assert.equal(counts.loneTechnicians, 1);
});

test('an inactive crew contributes nothing, and its members become lone units', () => {
  // Retiring a crew does not retire the people in it: they are still on the
  // roster and can still be sent work directly.
  const counts = capacityCounts(
    [{ id: 'a', is_active: false }],
    [{ id: 't1', is_active: true }],
    [{ crew_id: 'a', user_id: 't1' }],
  );
  assert.equal(counts.crewsWithMembers, 0, 'a retired crew is not capacity');
  assert.equal(counts.loneTechnicians, 1, 'but its technician still is');
});

test('a member of a retired crew is not double-counted after reactivation', () => {
  const counts = capacityCounts(
    [{ id: 'a', is_active: true }],
    [{ id: 't1', is_active: true }],
    [
      { crew_id: 'a', user_id: 't1' },
      // A stale link to a crew that no longer exists must not demote them.
      { crew_id: 'gone', user_id: 't1' },
    ],
  );
  assert.equal(counts.loneTechnicians, 0);
});

test('an inactive technician is not capacity, however they are linked', () => {
  const counts = capacityCounts(
    [{ id: 'a', is_active: true }],
    [{ id: 't1', is_active: false }],
    [{ crew_id: 'a', user_id: 't1' }],
  );
  assert.equal(counts.loneTechnicians, 0);
  // The crew still counts: it has a member row. Whether that member is on duty
  // is a separate problem, and `dispatch_load` already refuses inactive targets.
  assert.equal(counts.crewsWithMembers, 1);
});

test('an empty roster counts zero rather than throwing', () => {
  const counts = capacityCounts([], [], []);
  assert.deepEqual(counts, { crewsWithMembers: 0, loneTechnicians: 0 });
  assert.match(capacitySentence(0, 0, 'en'), /0 crews/);
});

// --- off-duty people inside an active crew --------------------------------------

test('an active crew cannot contain somebody who is off duty', async () => {
  const { inactiveMembersInActiveCrew } = await import('../src/lib/roster');

  // Verified live on 24/11/2026: this save succeeded before migration 034.
  const refusal = inactiveMembersInActiveCrew(true, [
    { id: 't1', full_name: 'Mustafe Axmed Xuseen', is_active: true },
    { id: 't2', full_name: 'Xasan Cali Nuur', is_active: false },
  ]);

  assert.ok(refusal, 'the save must be refused');
  assert.match(refusal!.en, /Xasan Cali Nuur is off duty/);
  assert.match(refusal!.en, /cannot be put in an active crew/);
  assert.match(refusal!.so, /Xasan Cali Nuur/);
  // Only the person who is actually off duty is named.
  assert.doesNotMatch(refusal!.en, /Mustafe/);
});

test('two people off duty are both named, and pluralised correctly', async () => {
  const { inactiveMembersInActiveCrew } = await import('../src/lib/roster');
  const refusal = inactiveMembersInActiveCrew(true, [
    { id: 'a', full_name: 'Cabdi', is_active: false },
    { id: 'b', full_name: 'Maxamed', is_active: false },
  ]);
  assert.match(refusal!.en, /Cabdi, Maxamed are off duty/);
});

test('a fully on-duty crew is accepted', async () => {
  const { inactiveMembersInActiveCrew } = await import('../src/lib/roster');
  assert.equal(
    inactiveMembersInActiveCrew(true, [{ id: 'a', full_name: 'Cabdi', is_active: true }]),
    null,
  );
});

test('a retiring crew may hold people who are also off duty', async () => {
  // Retiring a crew and its roster together is a legitimate order to do it in;
  // refusing this would make deactivation impossible without a gap.
  const { inactiveMembersInActiveCrew } = await import('../src/lib/roster');
  assert.equal(
    inactiveMembersInActiveCrew(false, [{ id: 'a', full_name: 'Cabdi', is_active: false }]),
    null,
  );
});
