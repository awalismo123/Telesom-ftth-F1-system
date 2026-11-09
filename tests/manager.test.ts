import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  groupCaption,
  groupTone,
  overdueLabel,
  overdueShare,
  portfolioAgrees,
  rankGroups,
  summarisePortfolio,
  windowLabel,
} from '../src/lib/manager';
import type { ManagerGroupRow } from '../src/lib/reads';

/**
 * Batch H — the read-only manager.
 *
 * Two things are tested here, and the second matters more than the first:
 *
 *  1. The arithmetic a manager reads off a card (what is late, which group is
 *     behind, does the headline agree with the rows).
 *  2. That "read-only" is not a promise made in CSS. The SQL refuses writes for
 *     a manager session, the manager functions contain no write verbs, and the
 *     manager screens import no write service.
 */

function group(over: Partial<ManagerGroupRow> = {}): ManagerGroupRow {
  return {
    id: 'g-f1',
    code: 'F1',
    name: 'Group F1',
    is_active: true,
    members: 5,
    technicians: 4,
    unassigned: 0,
    active: 5,
    blocked: 0,
    urgent: 0,
    waiting_over_sla: 0,
    completed: 33,
    photos: 0,
    avg_minutes: 142,
    last_activity_at: null,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* What the card says                                                          */
/* -------------------------------------------------------------------------- */

test('portfolio: overdue work outranks a blocker, which outranks a clean group', () => {
  assert.equal(groupTone({ waiting_over_sla: 2, blocked: 0, unassigned: 0 }), 'bad');
  assert.equal(groupTone({ waiting_over_sla: 1, blocked: 9, unassigned: 9 }), 'bad');
  assert.equal(groupTone({ waiting_over_sla: 0, blocked: 1, unassigned: 0 }), 'warn');
  assert.equal(groupTone({ waiting_over_sla: 0, blocked: 0, unassigned: 3 }), 'warn');
  assert.equal(groupTone({ waiting_over_sla: 0, blocked: 0, unassigned: 0 }), 'good');
});

test('portfolio: the late share is of open work, and never divides by zero', () => {
  assert.equal(overdueShare({ waiting_over_sla: 5, active: 5, unassigned: 0 }), 1);
  assert.equal(overdueShare({ waiting_over_sla: 1, active: 1, unassigned: 3 }), 0.25);
  assert.equal(overdueShare({ waiting_over_sla: 0, active: 0, unassigned: 0 }), 0);
  // A server that sent more late than open cannot produce >100%.
  assert.equal(overdueShare({ waiting_over_sla: 9, active: 1, unassigned: 0 }), 1);
});

test('portfolio: the label is a sentence, not a number with no unit', () => {
  assert.equal(overdueLabel({ waiting_over_sla: 0, active: 2, unassigned: 0 }, 'en'), 'On time');
  assert.equal(overdueLabel({ waiting_over_sla: 0, active: 2, unassigned: 0 }, 'so'), 'Waqtigeeda');
  assert.equal(overdueLabel({ waiting_over_sla: 1, active: 3, unassigned: 1 }, 'en'), '25% late');
  assert.match(overdueLabel({ waiting_over_sla: 1, active: 3, unassigned: 1 }, 'so'), /daahday$/);
});

test('portfolio: the group that needs reading first is listed first', () => {
  const ranked = rankGroups([
    group({ id: 'b', code: 'F2', waiting_over_sla: 0, blocked: 0, active: 9 }),
    group({ id: 'a', code: 'F1', waiting_over_sla: 4 }),
    group({ id: 'c', code: 'F3', waiting_over_sla: 0, blocked: 2, active: 1 }),
    group({ id: 'd', code: 'F5', waiting_over_sla: 0, blocked: 0, active: 9 }),
  ]);

  assert.deepEqual(
    ranked.map((row) => row.code),
    ['F1', 'F3', 'F2', 'F5'],
  );
});

test('portfolio: a group that has not launched reads as "not live", not as failing', () => {
  assert.equal(groupCaption(group({ is_active: false, members: 0 }), 'en'), 'Not live yet');
  assert.equal(groupCaption(group({ is_active: true, members: 0, technicians: 0 }), 'en'), 'No staff yet');
  assert.equal(groupCaption(group({ members: 5, technicians: 4 }), 'en'), '5 people · 4 technicians');
  assert.match(groupCaption(group({ members: 5, technicians: 4 }), 'so'), /farsamayaqaan/);
});

test('portfolio: the window is read as a length of time', () => {
  assert.equal(windowLabel(7, 'en'), '7 days');
  assert.equal(windowLabel(1, 'en'), '1 day');
  assert.equal(windowLabel(90, 'so'), '90 maalmood');
});

test('portfolio: the headline is the sum of the cards beneath it', () => {
  const summary = summarisePortfolio([
    group({ id: 'a', code: 'F1', waiting_over_sla: 5, active: 5, unassigned: 0, blocked: 0, completed: 33 }),
    group({ id: 'b', code: 'F2', is_active: false, members: 0, technicians: 0, waiting_over_sla: 0, active: 0, unassigned: 0, blocked: 0, completed: 0, photos: 0 }),
  ]);

  assert.deepEqual(summary, {
    liveGroups: 1,
    openJobs: 5,
    overdue: 5,
    blocked: 0,
    completed: 33,
    photos: 0,
  });
});

test('portfolio: a server total that disagrees with its own rows is caught', () => {
  const groups = [group({ waiting_over_sla: 5, active: 5, unassigned: 0, blocked: 0, completed: 33, photos: 4 })];

  const honest = {
    window_days: 30,
    generated_at: '2026-11-09T00:00:00Z',
    groups,
    totals: {
      members: 5, technicians: 4, unassigned: 0, active: 5, blocked: 0, urgent: 0,
      waiting_over_sla: 5, completed: 33, photos: 4, groups: 1, live_groups: 1,
    },
  };
  assert.equal(portfolioAgrees(honest), true);

  const lying = { ...honest, totals: { ...honest.totals, waiting_over_sla: 4 } };
  assert.equal(portfolioAgrees(lying), false);
});

/* -------------------------------------------------------------------------- */
/* Read-only, proven below the UI                                              */
/* -------------------------------------------------------------------------- */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const migration = read('supabase/migrations/014_batch_h_manager_role.sql');

test('manager: the role exists in the database, and a supervisor cannot mint one', () => {
  assert.match(migration, /CHECK \(role IN \('supervisor', 'technician', 'manager'\)\)/);
  assert.match(migration, /IF p_role NOT IN \('supervisor', 'technician'\) THEN/);
});

test('manager: every manager function is token-first, definer, and manager-only', () => {
  for (const fn of ['manager_portfolio', 'manager_activity', 'manager_report', 'manager_tasks']) {
    const start = migration.indexOf(`FUNCTION public.${fn}(`);
    assert.ok(start > 0, `${fn} is missing`);
    const body = migration.slice(start, start + 700);
    assert.match(body, /p_token uuid/, `${fn} must take the token first`);
  }
  const calls = migration.match(/v_user\.role <> 'manager'/g) ?? [];
  assert.ok(calls.length >= 4, 'each manager function must refuse a non-manager');
});

test('manager: the manager functions contain no write at all', () => {
  const start = migration.indexOf('-- 4. Portfolio — every group, at a glance');
  const end = migration.indexOf('GRANT EXECUTE ON FUNCTION public.manager_portfolio');
  const body = migration.slice(start, end);

  for (const verb of ['INSERT INTO', 'UPDATE public.', 'DELETE FROM']) {
    assert.equal(body.includes(verb), false, `a read-only role must not contain ${verb}`);
  }
});

test('manager: a manager session is refused by a trigger, not by a hidden button', () => {
  assert.match(migration, /FUNCTION public\.block_manager_writes\(\)/);
  assert.match(migration, /app\.actor_role/);
  assert.match(migration, /'manager' THEN\s+RAISE EXCEPTION 'A manager account is read-only'/);

  // The guard has to be on the operational tables, and must NOT be on the tables a
  // manager still legitimately writes: their own PIN and session.
  const list = migration.slice(migration.indexOf('FOREACH t IN ARRAY ARRAY['));
  const guarded = list.slice(0, list.indexOf(']'));
  for (const table of ['tasks', 'task_photos', 'cableboxes', 'cablebox_ports', 'dispatch_log']) {
    assert.ok(guarded.includes(`'${table}'`), `${table} must be guarded`);
  }
  for (const table of ['users', 'user_credentials', 'user_sessions']) {
    assert.equal(guarded.includes(`'${table}'`), false, `${table} must stay writable for a manager`);
  }
});

test('manager: the manager screens import no write path', () => {
  const dir = fileURLToPath(new URL('../src/components/manager', import.meta.url));
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => read(join('src/components/manager', file)));

  const forbidden = [
    'dispatchService',
    'opsService',
    'executionService',
    'importer',
    'commit_import_batch',
    'assignTasks',
    'cancelTask',
    'reopenTask',
    'completeTask',
    'startTask',
    'set_port_status',
  ];

  for (const source of sources) {
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `the manager bundle must not import ${token}`);
    }
  }
});

test('manager: the app opens the manager shell for a manager session', () => {
  const app = read('src/App.tsx');
  assert.match(app, /import\('\.\/components\/manager\/ManagerShell'\)/);
  assert.match(app, /manager \? \(/);
  assert.match(app, /<ManagerShell \/>/);
});
