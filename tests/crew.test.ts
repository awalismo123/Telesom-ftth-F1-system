import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CREW_MAX_MEMBERS,
  CREW_MIN_MEMBERS,
  checkCrewSize,
  crewSizeProblem,
  isDispatchable,
} from '../src/lib/crew';
import { crewsWithoutMembers, toTargets, type DispatchLoad } from '../src/lib/dispatchService';

/**
 * A crew is one or two people.
 *
 * This became a rule after measuring the live project: both active crews had
 * zero members, and earlier the same day one had three. Neither is possible
 * under the model — but the schema allowed both, and the supervisor's landing
 * screen counted empty crews as capacity.
 */

test('the model is one or two', () => {
  assert.equal(CREW_MIN_MEMBERS, 1);
  assert.equal(CREW_MAX_MEMBERS, 2);
});

test('one member is a crew', () => {
  assert.equal(crewSizeProblem(1, true), null);
  assert.equal(checkCrewSize(1, true).ok, true);
});

test('two members is a crew', () => {
  assert.equal(crewSizeProblem(2, true), null);
});

test('three members is not a crew', () => {
  assert.equal(crewSizeProblem(3, true), 'too-many');
  const check = checkCrewSize(3, true);
  assert.equal(check.ok, false);
  assert.match(check.message!.en, /one or two/);
});

test('an active crew with nobody is rejected', () => {
  assert.equal(crewSizeProblem(0, true), 'empty-active');
  assert.equal(checkCrewSize(0, true).ok, false);
});

test('an INACTIVE crew with nobody is allowed — that is how a crew is retired', () => {
  // Blocking this would leave a supervisor no way to take a vehicle out of
  // service without deleting its history.
  assert.equal(crewSizeProblem(0, false), null);
  assert.equal(checkCrewSize(0, false).ok, true);
});

test('the size problem outranks the empty check', () => {
  // A four-person inactive crew is still not a crew.
  assert.equal(crewSizeProblem(4, false), 'too-many');
});

test('every rejection carries copy in both languages, and they differ', () => {
  for (const problem of ['too-many', 'empty-active'] as const) {
    const check = checkCrewSize(problem === 'too-many' ? 3 : 0, true);
    assert.equal(check.problem, problem);
    assert.ok(check.message!.en.length > 10, `${problem} has no English copy`);
    assert.ok(check.message!.so.length > 10, `${problem} has no Somali copy`);
    assert.notEqual(check.message!.en, check.message!.so, `${problem} is not translated`);
  }
});

test('an empty active crew cannot be dispatched', () => {
  assert.equal(isDispatchable(0, true), false);
  assert.equal(isDispatchable(1, true), true);
  assert.equal(isDispatchable(2, true), true);
  assert.equal(isDispatchable(2, false), false);
});

// ── Dispatch targets ───────────────────────────────────────────────────────

const emptyCrew = (id: string, name: string) => ({
  id,
  name,
  vehicle_tag: null,
  zone_focus: null,
  members: [],
  open_jobs: 0,
  active_jobs: 0,
  done_today: 0,
  urgent_jobs: 0,
});

const load: DispatchLoad = {
  users: [],
  crews: [
    { ...emptyCrew('c1', 'Crew A'), members: [{ id: 'u1', full_name: 'Cabdi Xasan' }] },
    emptyCrew('c2', 'Crew B'),
    {
      ...emptyCrew('c3', 'Crew C'),
      members: [
        { id: 'u2', full_name: 'Maxamed Cali' },
        { id: 'u3', full_name: 'Mustafe Nuur' },
      ],
    },
  ],
};

test('a crew with nobody is not offered as a dispatch target', () => {
  const ids = toTargets(load).map((target) => target.id);
  assert.deepEqual(ids, ['c1', 'c3'], 'Crew B has no members and must not be dispatchable');
});

test('the crewless crews are still reported, not silently dropped', () => {
  // Filtering them out of the targets without saying so would make a crew
  // disappear from the board with no explanation.
  const stranded = crewsWithoutMembers(load);
  assert.deepEqual(
    stranded.map((crew) => crew.name),
    ['Crew B'],
  );
});

test('a crew member list that is missing rather than empty does not crash the board', () => {
  // `members` comes from a jsonb blob; an older RPC shape may omit it.
  const partial = {
    users: [],
    crews: [{ ...emptyCrew('c9', 'Crew Z'), members: undefined as never }],
  } as DispatchLoad;
  assert.doesNotThrow(() => toTargets(partial));
  assert.deepEqual(toTargets(partial), []);
  assert.equal(crewsWithoutMembers(partial).length, 1);
});

test('a two-person crew is named by both partners', () => {
  const target = toTargets(load).find((item) => item.id === 'c3');
  assert.match(target!.subtitle ?? '', /Maxamed \+ Mustafe/);
});

// ── The database must agree with the code ──────────────────────────────────

test('migration 023 enforces the same cap the UI does', () => {
  // Two numbers in two languages again: CREW_MAX_MEMBERS here, `>= 2` in the
  // trigger. If one moves without the other, the UI either blocks a legal crew
  // or lets a write through that the database then rejects after the fact.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/023_crew_size_rules.sql', import.meta.url)),
    'utf8',
  );

  // Take the body between the two `$fn$` delimiters, not the header before it.
  const afterHeader = sql.slice(sql.indexOf('FUNCTION public.enforce_crew_size'));
  const body = afterHeader.slice(afterHeader.indexOf('$fn$') + 4);
  const triggerBody = body.slice(0, body.indexOf('$fn$'));
  const cap = triggerBody.match(/v_count\s*>=\s*(\d+)/)?.[1];

  assert.ok(cap, 'could not find the crew cap in enforce_crew_size — has the function moved?');
  assert.equal(
    Number(cap),
    CREW_MAX_MEMBERS,
    'the UI and the database disagree about how many people a crew holds',
  );
});

test('the active-crew floor is enforced in upsert_crew too', () => {
  // The trigger only caps the upper bound; the "at least one member" rule lives
  // in upsert_crew. A crew saved through the RPC is the only path the app uses.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/023_crew_size_rules.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /p_is_active\s+AND\s+v_members\s*=\s*0/);
});

test('crews_total stops counting crews that have nobody in them', () => {
  // This is the fix for the misleading number: an empty crew still exists as a
  // row, so a plain `count(*) where is_active` reported capacity that was not
  // there.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/023_crew_size_rules.sql', import.meta.url)),
    'utf8',
  );
  const total = sql.slice(sql.indexOf("'crews_total'"));
  assert.match(
    total.slice(0, 400),
    /EXISTS \(SELECT 1 FROM public\.crew_members/,
    'crews_total must require a member, or the count lies again',
  );
  assert.match(sql, /'crews_empty'/, 'the stranded crews must be reportable');
});
