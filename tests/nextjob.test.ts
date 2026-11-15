import test from 'node:test';
import assert from 'node:assert/strict';
import { nextJob } from '../src/lib/execution';
import type { RouteTask } from '../src/lib/execution';

/**
 * "Next job" is a claim about what a person should physically do next. It is
 * the sort order of the list underneath, read once — so these tests exist to
 * keep the claim and the list from drifting apart, and to pin the three
 * reasons that change what the button says.
 */

let seq = 0;
function task(overrides: Partial<RouteTask>): RouteTask {
  seq += 1;
  return {
    id: `task-${seq}`,
    line_number: `LN${String(seq).padStart(3, '0')}`,
    customer_name: `Customer ${seq}`,
    status: 'assigned',
    priority: 'normal',
    reported_date: '2026-11-01',
    ...overrides,
  } as RouteTask;
}

test('an empty route has no next job', () => {
  assert.equal(nextJob([]), null);
});

test('a finished route has no next job', () => {
  const tasks = [
    task({ status: 'completed' }),
    task({ status: 'cancelled' }),
  ];
  assert.equal(nextJob(tasks), null, 'completed and cancelled work is not "next"');
});

test('a running job is not "next" — it already has the whole screen', () => {
  // A live timer plus a second Start button is how people begin two jobs.
  const running = task({ status: 'in_progress', priority: 'urgent' });
  const open = task({ status: 'assigned' });
  assert.equal(nextJob([running, open])?.task.id, open.id);
});

test('a blocked job outranks everything, because somebody is waiting', () => {
  const blocked = task({ status: 'blocked', priority: 'normal' });
  const urgent = task({ status: 'assigned', priority: 'urgent' });
  const result = nextJob([urgent, blocked]);
  assert.equal(result?.task.id, blocked.id);
  assert.equal(result?.reason, 'blocked');
});

test('urgent outranks routine among open jobs', () => {
  const routine = task({ status: 'assigned', priority: 'normal' });
  const urgent = task({ status: 'assigned', priority: 'urgent' });
  const result = nextJob([routine, urgent]);
  assert.equal(result?.task.id, urgent.id);
  assert.equal(result?.reason, 'urgent');
});

test('the oldest report wins when urgency is equal', () => {
  const newer = task({ status: 'assigned', reported_date: '2026-11-05' });
  const older = task({ status: 'assigned', reported_date: '2026-11-01' });
  assert.equal(nextJob([newer, older])?.task.id, older.id);
});

test('the reason is carried, not inferred twice', () => {
  assert.equal(nextJob([task({ status: 'assigned' })])?.reason, 'routine');
  assert.equal(nextJob([task({ status: 'assigned', priority: 'urgent' })])?.reason, 'urgent');
  assert.equal(nextJob([task({ status: 'blocked' })])?.reason, 'blocked');
});

test('it agrees with the order the list is drawn in', () => {
  // The band and the list below it must never disagree — a technician reading
  // "next" and then seeing a different card first would stop trusting both.
  const tasks = [
    task({ status: 'completed' }),
    task({ status: 'assigned', priority: 'normal', reported_date: '2026-11-02' }),
    task({ status: 'blocked' }),
    task({ status: 'assigned', priority: 'urgent', reported_date: '2026-11-03' }),
    task({ status: 'cancelled' }),
  ];

  const chosen = nextJob(tasks)?.task.id;
  const firstOpenInList = tasks
    .slice()
    .sort((a, b) => {
      const rank = (t: RouteTask) =>
        t.status === 'in_progress' ? 0 : t.status === 'blocked' ? 1 : t.status === 'completed' || t.status === 'cancelled' ? 3 : 2;
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
      const da = a.reported_date ?? '';
      const db = b.reported_date ?? '';
      if (da !== db) return da < db ? -1 : 1;
      return a.line_number.localeCompare(b.line_number);
    })
    .find((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'in_progress');

  assert.equal(chosen, firstOpenInList?.id);
});
