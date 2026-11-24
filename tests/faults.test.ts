import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FAULT_SLA_DAYS,
  FAULT_TYPES,
  FAULT_TYPE_LABEL,
  INSTALL_SLA_DAYS,
  KIND_LABEL,
  URGENCY_LABEL,
  asFaultType,
  bulkDeletePlan,
  faultAgeDays,
  faultQueue,
  faultSentence,
  faultTypeLabel,
  faultUrgency,
  hasPlace,
  slaDays,
  summariseFaults,
  taskKind,
  whyNoDelete,
} from '../src/lib/faults';
import type { Task } from '../src/types/database';

/**
 * Faults and installations are two systems with two clocks.
 *
 * The tests that matter here are:
 *
 *  1. **The clock is defined twice and must agree.** It lives in the database
 *     (`task_sla_days`) because `today_summary` counts with it, and in this
 *     module because the screens sort with it. One test reads the migration and
 *     compares, because two copies that drift is exactly the defect the overview
 *     and dispatch phases were spent removing.
 *  2. **A fault is ordered by age, not by the urgent flag** — deliberately the
 *     opposite of the installation pool.
 *  3. **The delete policy on the client matches the one in the database**, so a
 *     button is never offered for something the server will refuse.
 */

const TODAY = '2026-11-24';

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    group_id: 'g1',
    line_number: '573864',
    customer_name: 'HOODO IDIRIS',
    customer_phone: '0634111111',
    xaafada: 'Jigjigayar',
    cablebox_code_raw: null,
    status: 'unassigned',
    priority: 'normal',
    task_type: 'cilada',
    reported_date: '2026-11-24',
    created_at: '2026-11-24T08:00:00Z',
    accumulated_seconds: 0,
    fault_type: null,
    ...over,
  }) as Task;

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/033_faults_and_job_editing.sql', import.meta.url)),
  'utf8',
);

/* -------------------------------------------------------------------------- */
/* The clock, and the copy that must not drift                                */
/* -------------------------------------------------------------------------- */

test('a fault is promised in 2 days and an installation in 3', () => {
  assert.equal(slaDays(task({ task_type: 'cilada' })), 2);
  assert.equal(slaDays(task({ task_type: 'installation' })), 3);
  assert.equal(FAULT_SLA_DAYS, 2);
  assert.equal(INSTALL_SLA_DAYS, 3);
});

test('the migration defines the same two windows', () => {
  // The database counts `over_sla` with this function. If the two copies drift,
  // the overview and the fault tab report different numbers for the same work.
  assert.match(migration, /WHEN p_task_type = 'cilada' THEN 2 ELSE 3/);
  assert.match(migration, /< now\(\) - make_interval\(days => public\.task_sla_days/);
  assert.match(migration, /today_summary/);
});

test('today_summary no longer hardcodes a single window', () => {
  // `interval '3 days'` was the old rule and applied to faults as well.
  const summary = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.today_summary'));
  assert.doesNotMatch(
    summary.slice(0, summary.indexOf('$fn$;')),
    /interval '3 days'/,
    'the hardcoded three-day window must be gone',
  );
});

test('the fault type list matches the CHECK constraint', () => {
  // Every value the client can send must be one the database accepts.
  for (const type of FAULT_TYPES) {
    assert.ok(
      migration.includes(`'${type}'`),
      `${type} is offered by the client but missing from the CHECK`,
    );
  }
});

test('a fault belongs to the fault system, an installation to the other', () => {
  assert.equal(taskKind(task({ task_type: 'cilada' })), 'fault');
  assert.equal(taskKind(task({ task_type: 'installation' })), 'install');
});

test('both kinds are named in both languages', () => {
  assert.equal(KIND_LABEL.fault.so, 'Cilada');
  assert.equal(KIND_LABEL.install.en, 'Installation');
});

/* -------------------------------------------------------------------------- */
/* Age and urgency                                                            */
/* -------------------------------------------------------------------------- */

test('age is counted from the report date, and never negative', () => {
  assert.equal(faultAgeDays(task({ reported_date: TODAY }), TODAY), 0);
  assert.equal(faultAgeDays(task({ reported_date: '2026-11-20' }), TODAY), 4);
  assert.equal(faultAgeDays(task({ reported_date: '2026-12-01' }), TODAY), 0);
});

test('a job with no date has unknown age, not age zero', () => {
  assert.equal(faultAgeDays(task({ reported_date: null, created_at: null }), TODAY), null);
});

test('a fault breaches after two days, an installation after three', () => {
  const fault = { task_type: 'cilada' as const, created_at: null };
  const install = { task_type: 'installation' as const, created_at: null };

  assert.equal(faultUrgency({ ...fault, reported_date: '2026-11-22' }, TODAY), 'due');
  assert.equal(faultUrgency({ ...fault, reported_date: '2026-11-21' }, TODAY), 'breach');
  assert.equal(faultUrgency({ ...fault, reported_date: '2026-11-23' }, TODAY), 'soon');

  // The same age is not late for an installation. This is the entire point.
  assert.equal(faultUrgency({ ...install, reported_date: '2026-11-21' }, TODAY), 'due');
  assert.equal(faultUrgency({ ...install, reported_date: '2026-11-20' }, TODAY), 'breach');
  // "Due tomorrow" for a three-day promise is day two, not day one.
  assert.equal(faultUrgency({ ...install, reported_date: '2026-11-22' }, TODAY), 'soon');
  assert.equal(faultUrgency({ ...install, reported_date: '2026-11-23' }, TODAY), 'fresh');
});

test('every urgency is labelled in both languages', () => {
  for (const [key, label] of Object.entries(URGENCY_LABEL)) {
    assert.ok(label.en.length > 0, key);
    assert.ok(label.so.length > 0, key);
    assert.notEqual(label.en, label.so, key);
  }
});

/* -------------------------------------------------------------------------- */
/* The fault queue                                                            */
/* -------------------------------------------------------------------------- */

test('the queue holds only faults, and only open ones', () => {
  const rows = faultQueue(
    [
      task({ id: 'f1', task_type: 'cilada' }),
      task({ id: 'i1', task_type: 'installation' }),
      task({ id: 'done', task_type: 'cilada', status: 'completed' }),
      task({ id: 'gone', task_type: 'cilada', status: 'cancelled' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ['f1'],
  );
});

test('a breached fault beats a merely urgent one', () => {
  // Deliberately the opposite of the installation pool: the four-day-old fault
  // is a customer who has already told three neighbours.
  const rows = faultQueue(
    [
      task({ id: 'flagged', priority: 'urgent', reported_date: '2026-11-23' }),
      task({ id: 'breached', priority: 'normal', reported_date: '2026-11-19' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ['breached', 'flagged'],
  );
});

test('within the same urgency, the older fault comes first', () => {
  const rows = faultQueue(
    [
      task({ id: 'newer', reported_date: '2026-11-20' }),
      task({ id: 'older', reported_date: '2026-11-18' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ['older', 'newer'],
  );
});

test('a fault with unknown age sorts last, never first', () => {
  const rows = faultQueue(
    [
      task({ id: 'unknown', reported_date: null, created_at: null }),
      task({ id: 'known', reported_date: '2026-11-24' }),
    ],
    TODAY,
  );
  assert.deepEqual(
    rows.map((row) => row.task.id),
    ['known', 'unknown'],
  );
});

test('the queue carries the fault type and reads an unknown one as absent', () => {
  const rows = faultQueue(
    [
      task({ id: 'typed', fault_type: 'cut_cable' }),
      task({ id: 'bogus', fault_type: 'meteor_strike' }),
    ],
    TODAY,
  );
  const byId = new Map(rows.map((row) => [row.task.id, row]));
  assert.equal(byId.get('typed')?.type, 'cut_cable');
  assert.equal(byId.get('bogus')?.type, null, 'an unknown type must not reach the screen');
});

test('ordering is stable for identical faults', () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    task({ id: `f${i}`, line_number: `L${i}`, reported_date: '2026-11-20' }),
  );
  const a = faultQueue(rows, TODAY).map((row) => row.task.id);
  const b = faultQueue([...rows].reverse(), TODAY).map((row) => row.task.id);
  assert.deepEqual(a, b);
});

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

test('only the eight listed types are accepted', () => {
  assert.equal(FAULT_TYPES.length, 8);
  assert.equal(asFaultType('cut_cable'), 'cut_cable');
  assert.equal(asFaultType('CUT_CABLE'), null);
  assert.equal(asFaultType(''), null);
  assert.equal(asFaultType(null), null);
  assert.equal(asFaultType(42), null);
});

test('every type has a label and a plain-language hint in both languages', () => {
  for (const type of FAULT_TYPES) {
    const entry = FAULT_TYPE_LABEL[type];
    assert.ok(entry.en.length > 0, type);
    assert.ok(entry.so.length > 0, type);
    assert.ok(entry.hint.en.length > 10, `${type} needs a usable hint`);
    assert.ok(entry.hint.so.length > 10, `${type} needs a usable hint in Somali`);
  }
});

test('an unrecorded fault type reads as absent, not as a guess', () => {
  // Nine faults in the live database have no type. The screen must say so.
  assert.equal(faultTypeLabel(null, 'en'), null);
  assert.equal(faultTypeLabel('', 'en'), null);
  assert.equal(faultTypeLabel('cut_cable', 'en'), 'Cut cable');
  assert.equal(faultTypeLabel('cut_cable', 'so'), 'Xadhig go’ay');
});

/* -------------------------------------------------------------------------- */
/* Summary and sentence                                                       */
/* -------------------------------------------------------------------------- */

test('the summary counts breached, untyped and unplaceable separately', () => {
  const rows = faultQueue(
    [
      task({ id: 'a', reported_date: '2026-11-18', fault_type: 'cut_cable' }),
      task({ id: 'b', reported_date: '2026-11-19', fault_type: null, xaafada: null }),
      task({ id: 'c', reported_date: '2026-11-22', fault_type: 'no_signal' }),
      task({ id: 'd', reported_date: '2026-11-24', fault_type: 'power' }),
    ],
    TODAY,
  );
  const summary = summariseFaults(rows);

  assert.equal(summary.open, 4);
  assert.equal(summary.breached, 2);
  assert.equal(summary.due, 1);
  assert.equal(summary.untyped, 1);
  assert.equal(summary.unplaceable, 1);
});

test('the sentence leads with the broken promise, because that is what costs money', () => {
  const text = faultSentence(
    { open: 9, breached: 9, due: 0, untyped: 9, unplaceable: 6 },
    'en',
  );
  assert.match(text, /9 of 9/);
  assert.match(text, /broken the promise/);
});

test('a clear fault list says so plainly', () => {
  assert.match(faultSentence({ open: 0, breached: 0, due: 0, untyped: 0, unplaceable: 0 }, 'en'), /No open faults/);
  assert.match(faultSentence({ open: 0, breached: 0, due: 0, untyped: 0, unplaceable: 0 }, 'so'), /Ma jiro/);
});

test('the sentence is translated and separates untracked from unfixed', () => {
  const summary = { open: 4, breached: 1, due: 0, untyped: 2, unplaceable: 1 };
  const en = faultSentence(summary, 'en');
  assert.match(en, /no fault type/);
  assert.match(en, /no area/);
  assert.notEqual(en, faultSentence(summary, 'so'));
});

/* -------------------------------------------------------------------------- */
/* Delete policy, mirrored                                                    */
/* -------------------------------------------------------------------------- */

test('the client refuses to offer a delete the database will reject', () => {
  // A button offered for something the server refuses is a bug the user sees.
  assert.ok(whyNoDelete(task({ status: 'completed' }), 0));
  assert.ok(whyNoDelete(task({ completed_at: '2026-11-24T10:00:00Z' }), 0));
  assert.ok(whyNoDelete(task({ assigned_user_id: 'u1' }), 0));
  assert.ok(whyNoDelete(task({ assigned_crew_id: 'c1' }), 0));
  assert.ok(whyNoDelete(task({ active_started_at: '2026-11-24T10:00:00Z' }), 0));
  assert.ok(whyNoDelete(task({ accumulated_seconds: 90 }), 0));
  assert.ok(whyNoDelete(task({ blocked_at: '2026-11-24T10:00:00Z' }), 0));
  assert.ok(whyNoDelete(task({ proof_photo_id: 'p1' }), 0));
  assert.ok(whyNoDelete(task(), 1), 'a work log is enough to refuse');
});

test('a job nobody touched can be deleted', () => {
  assert.equal(whyNoDelete(task({ status: 'unassigned' }), 0), null);
});

test('the refusal is explained, in both languages', () => {
  const reason = whyNoDelete(task({ status: 'completed' }), 0)!;
  assert.match(reason.en, /never be deleted/);
  assert.match(reason.so, /lama tirtiri karo/);

  const worked = whyNoDelete(task({ accumulated_seconds: 60 }), 0)!;
  assert.match(worked.en, /Cancel it instead/);
  assert.match(worked.so, /jooji/i);
});

test('the migration enforces exactly the policy the client mirrors', () => {
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_task'));
  const fn = body.slice(0, body.indexOf('$fn$;'));

  // Each guard the client mirrors must exist in the function.
  for (const needle of [
    "v_task.status = 'completed'",
    'v_task.active_started_at IS NOT NULL',
    'v_task.assigned_user_id IS NOT NULL',
    'v_task.assigned_crew_id IS NOT NULL',
    'v_task.accumulated_seconds',
    'v_task.blocked_at IS NOT NULL',
    'v_task.proof_photo_id IS NOT NULL',
    // Provenance is excluded: every imported job carries an `imported` row, so
    // counting it made freshly imported jobs undeletable — the one case delete
    // exists for.
    "FROM public.task_work_logs\n  WHERE task_id = p_task_id\n    AND action <> 'imported'",
    'FROM public.task_photos WHERE task_id = p_task_id',
    'FROM public.task_materials WHERE task_id = p_task_id',
    'FROM public.cablebox_logs WHERE task_id = p_task_id',
  ]) {
    assert.ok(fn.includes(needle), `delete_task must check: ${needle}`);
  }
});

test('a delete is recorded in the import batch before the row goes', () => {
  // Otherwise a wrongly-imported sheet leaves no trace at all.
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_task'));
  const fn = body.slice(0, body.indexOf('$fn$;'));
  const record = fn.indexOf("'deleted'");
  const del = fn.indexOf('DELETE FROM public.tasks');

  assert.ok(record > -1, 'the deletion must be recorded');
  assert.ok(del > -1, 'the row must be deleted');
  assert.ok(record < del, 'it must be recorded BEFORE the row is deleted');
});

test('edit_task refuses to rewrite a cancelled job', () => {
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.edit_task'));
  const fn = body.slice(0, body.indexOf('$fn$;'));
  assert.match(fn, /v_task\.status = 'cancelled'/);
  assert.match(fn, /Reopen it before changing/);
});

test('edit_task logs the previous values', () => {
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.edit_task'));
  const fn = body.slice(0, body.indexOf('$fn$;'));
  assert.match(fn, /v_before := jsonb_build_object/);
  assert.match(fn, /'edited'/);
});

// --- the bulk delete plan ---------------------------------------------------
//
// The sheet that shows "3 can go, 5 will be kept" used to compute that count in
// a JSX expression, where it could only be tested with a browser that this
// environment does not have. It lives here now, so the promise a supervisor
// reads before pressing delete is checkable.

test('a bulk delete separates what can go from what must be cancelled', () => {
  const clean = task({ status: 'unassigned' });
  const worked = task({ status: 'completed' });
  const started = task({ status: 'in_progress' });
  const cancelled = task({ status: 'cancelled' });

  const plan = bulkDeletePlan([clean, worked, started, cancelled]);

  assert.deepEqual(
    plan.deletable.map((row) => row.status),
    ['unassigned', 'cancelled'],
    'only a job nobody worked on can go',
  );
  assert.deepEqual(
    plan.kept.map((row) => row.status),
    ['completed', 'in_progress'],
  );
  // Nothing is lost between the two lists: every selected job is accounted for.
  assert.equal(plan.deletable.length + plan.kept.length, 4);
});

test('the bulk delete plan agrees with whyNoDelete on every status', () => {
  // The two must not drift: the sheet shows `whyNoDelete`'s reason next to each
  // kept row, and a row with a reason but no refusal (or the reverse) would show
  // a supervisor a contradiction.
  const statuses: Task['status'][] = [
    'unassigned',
    'assigned',
    'in_progress',
    'blocked',
    'paused',
    'completed',
    'cancelled',
  ];

  for (const status of statuses) {
    const row = task({ status });
    const plan = bulkDeletePlan([row]);
    const reason = whyNoDelete(row, 0);
    assert.equal(
      plan.deletable.length === 1,
      reason === null,
      `status ${status} must agree between the plan and the reason`,
    );
  }
});

test('an empty selection plans nothing and promises nothing', () => {
  const plan = bulkDeletePlan([]);
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.kept.length, 0);
});

// --- placement ---------------------------------------------------------------
//
// `hasPlace` here and `hasRoute` in dispatchBoard answer the same question, and
// two definitions of "can this be routed" is exactly the kind of drift that lets
// a board promise a plan it cannot make. They are duplicated only to keep
// faults.ts free of the board's imports, so they are pinned to each other.

test('hasPlace and hasRoute agree on every combination of area and box', async () => {
  const { hasRoute } = await import('../src/lib/dispatchBoard');

  const cases: [string | null, string | null][] = [
    ['Jigjigayar', 'CB190-229 (06)'],
    ['Jigjigayar', null],
    [null, 'CB190-229 (06)'],
    [null, null],
    ['   ', '   '],
    ['', ''],
    [' Jigjigayar ', null],
  ];

  for (const [area, box] of cases) {
    const row = task({ xaafada: area, cablebox_code_raw: box });
    assert.equal(
      hasPlace(row),
      hasRoute(row),
      `area=${JSON.stringify(area)} box=${JSON.stringify(box)} must be judged the same`,
    );
  }
});

test('the live census: a fault with no area and no box is unplaceable', () => {
  // The 24/11 sheet: 13 of 15 open faults looked like this.
  const rule = { xaafada: null, cablebox_code_raw: null };
  assert.equal(hasPlace(task(rule)), false);

  // Two of the fifteen had a box and no area, which is enough.
  assert.equal(hasPlace(task({ xaafada: null, cablebox_code_raw: 'B5 (241)' })), true);
  assert.equal(hasPlace(task({ xaafada: null, cablebox_code_raw: 'CB230-318 (64)' })), true);
});

test('a fault queue row carries its own placement verdict', () => {
  const rows = faultQueue(
    [
      task({ id: 'placed', xaafada: 'Jigjigayar', cablebox_code_raw: null }),
      task({ id: 'placeless', xaafada: null, cablebox_code_raw: null }),
    ],
    TODAY,
  );

  const placed = rows.find((row) => row.task.id === 'placed')!;
  const placeless = rows.find((row) => row.task.id === 'placeless')!;
  assert.equal(placed.place, true);
  assert.equal(placeless.place, false);

  // And the summary counts agree with the rows, so the button's number and the
  // rows it selects cannot disagree.
  assert.equal(summariseFaults(rows).unplaceable, 1);
});
