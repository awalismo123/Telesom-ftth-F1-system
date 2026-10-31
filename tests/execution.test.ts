import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteTask } from '../src/lib/execution';
import {
  DBM_PRESETS,
  dbmTone,
  elapsedSeconds,
  formatClock,
  formatDuration,
  groupRoute,
  parseDbm,
  routeStats,
  serverOffsetMs,
  sortRoute,
  taskWarnings,
} from '../src/lib/execution';

const NOW = Date.parse('2026-10-28T10:00:00Z');

let seq = 0;
function makeTask(overrides: Partial<RouteTask> = {}): RouteTask {
  seq += 1;
  return {
    id: `task-${seq}`,
    group_id: 'g1',
    import_batch_id: null,
    sheet_row_id: null,
    task_type: 'cilada',
    line_number: `50000${seq}`,
    customer_name: 'CUSTOMER',
    customer_phone: '634000000',
    x_number: null,
    router_state: null,
    complain_type: null,
    dedup_key: null,
    disc_code: null,
    service_type: 'Fiber',
    work_subtype: null,
    speed_plan: null,
    xaafada: null,
    cablebox_code_raw: null,
    cablebox_id: null,
    port_number: null,
    reported_date: '2026-10-28',
    reported_time: null,
    priority: 'normal',
    carryover_count: 0,
    is_repeat_fault: false,
    is_urgent: false,
    previous_task_id: null,
    previous_fault_summary: null,
    status: 'assigned',
    assigned_user_id: null,
    assigned_crew_id: null,
    assigned_by: null,
    assigned_at: null,
    active_started_at: null,
    active_started_by: null,
    accumulated_seconds: 0,
    blocker_reason: null,
    blocker_notes: null,
    blocked_at: null,
    optical_dbm: null,
    completion_notes: null,
    completed_at: null,
    completed_by: null,
    scheduled_date: '2026-10-28',
    created_at: '2026-10-28',
    damaged_ports: null,
    cablebox_health: null,
    cablebox_ports: null,
    cablebox_notes: null,
    cablebox_olt_path: null,
    box_issues: [],
    ...overrides,
  } as RouteTask;
}

test('the clock is derived from the server, never accumulated on the phone', () => {
  assert.equal(elapsedSeconds(makeTask({ accumulated_seconds: 300 }), NOW), 300);

  assert.equal(
    elapsedSeconds(makeTask({ accumulated_seconds: 300, active_started_at: '2026-10-28T09:58:00Z' }), NOW),
    420,
  );

  // A handset whose clock is ahead must not erase banked time.
  assert.equal(
    elapsedSeconds(makeTask({ accumulated_seconds: 60, active_started_at: '2026-10-28T11:00:00Z' }), NOW),
    60,
  );

  assert.equal(elapsedSeconds(makeTask({ accumulated_seconds: 45, active_started_at: 'not-a-date' }), NOW), 45);
});

test('clock formatting', () => {
  assert.equal(formatClock(59), '00:59');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock(3600), '01:00:00');
  assert.equal(formatClock(3725), '01:02:05');
  assert.equal(formatDuration(3725, 'en'), '1h 2m');
  assert.equal(formatDuration(125, 'so'), '2d 5s');
});

test('server offset corrects a wrong phone clock', () => {
  assert.equal(serverOffsetMs('2026-10-28T10:00:00Z', Date.parse('2026-10-28T09:59:30Z')), 30_000);
});

test('dBm parsing accepts how technicians actually type', () => {
  assert.equal(parseDbm('-21.5').value, -21.5);
  assert.equal(parseDbm('21.5').value, -21.5);
  assert.equal(parseDbm('-20,25').value, -20.25);
  assert.deepEqual(parseDbm('-19.4'), { value: -19.4, error: null, warning: null });

  assert.notEqual(parseDbm('').error, null);
  assert.notEqual(parseDbm('-45').error, null);
  assert.notEqual(parseDbm('abc').error, null);

  assert.notEqual(parseDbm('-29').warning, null);
  assert.notEqual(parseDbm('-3').warning, null);
});

test('dBm tone matches the healthy window', () => {
  assert.equal(dbmTone(-21), 'good');
  assert.equal(dbmTone(-30), 'bad');
  assert.ok(DBM_PRESETS.every((value) => value < 0));
});

test('route ordering puts live work first', () => {
  const tasks = [
    makeTask({ line_number: '3', status: 'assigned', priority: 'urgent' }),
    makeTask({ line_number: '1', status: 'in_progress', active_started_at: '2026-10-28T09:50:00Z' }),
    makeTask({ line_number: '2', status: 'blocked', blocker_reason: 'fiber_break' }),
    makeTask({ line_number: '4', status: 'completed', completed_at: '2026-10-28T08:00:00Z' }),
    makeTask({ line_number: '5', status: 'assigned' }),
  ];

  assert.deepEqual(
    sortRoute(tasks).map((task) => task.line_number),
    ['1', '2', '3', '5', '4'],
  );
});

test('grouping prefers the cablebox and falls back to the area', () => {
  const tasks = [
    makeTask({ line_number: '3', cablebox_code_raw: 'FAT48', xaafada: 'Jigjigayar' }),
    makeTask({ line_number: '1', status: 'in_progress' }),
    makeTask({ line_number: '2', status: 'blocked' }),
    makeTask({ line_number: '5', xaafada: 'Bada Cas' }),
    makeTask({ line_number: '4', status: 'completed' }),
  ];

  assert.deepEqual(
    groupRoute(tasks, 'en').map((section) => `${section.label}:${section.tasks.length}`),
    ['No area:2', 'FAT48:1', 'Bada Cas:1'],
  );
});

test('route stats feed the summary strip', () => {
  const stats = routeStats([
    makeTask({ status: 'in_progress' }),
    makeTask({ status: 'blocked' }),
    makeTask({ status: 'assigned', priority: 'urgent' }),
    makeTask({ status: 'assigned' }),
    makeTask({ status: 'completed', completed_at: new Date().toISOString() }),
  ]);

  assert.equal(stats.open, 4);
  assert.equal(stats.urgent, 1);
  assert.equal(stats.running, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.doneToday, 1);
});

test('warnings surface what the last technician learned', () => {
  assert.ok(taskWarnings(makeTask({ router_state: 'not_collected' })).some((w) => w.key === 'router'));
  assert.ok(
    taskWarnings(makeTask({ port_number: 7, damaged_ports: [7], cablebox_code_raw: 'FAT48' })).some(
      (w) => w.key === 'damaged-port',
    ),
  );
  assert.ok(
    taskWarnings(makeTask({ port_number: 2, damaged_ports: [7] })).some((w) => w.key === 'damaged-others'),
  );
  assert.ok(taskWarnings(makeTask({ cablebox_health: 'critical' })).some((w) => w.key === 'box-health'));
  assert.equal(taskWarnings(makeTask()).length, 0);
});
