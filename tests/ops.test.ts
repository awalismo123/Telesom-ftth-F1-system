import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CANCEL_REASONS,
  buildSupervisorNotifications,
  buildTechnicianNotifications,
  cancelReasonText,
  emptyBoxDraft,
  emptyManualDraft,
  isFinished,
  isOpen,
  normaliseBoxCode,
  searchQueryIsUsable,
  statusLabel,
  validateBoxDraft,
  validateManualTask,
} from '../src/lib/ops';

/**
 * Batch E is the batch where the app starts *changing* work, not just showing
 * it. The rules that decide what the database is asked to do are pure functions,
 * so they are pinned here.
 */

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

test('cancelled is finished, never open', () => {
  assert.equal(isOpen('cancelled'), false);
  assert.equal(isFinished('cancelled'), true);
  assert.equal(isOpen('blocked'), true);
  assert.equal(isFinished('completed'), true);
  assert.equal(statusLabel('cancelled', 'en'), 'Cancelled');
  assert.equal(statusLabel('cancelled', 'so'), 'La joojiyay');
});

/* -------------------------------------------------------------------------- */
/* Cablebox form                                                               */
/* -------------------------------------------------------------------------- */

test('box codes normalise the way the importer and the database do', () => {
  assert.equal(normaliseBoxCode(' fat 48 '), 'FAT 48');
  assert.equal(normaliseBoxCode('b6   (52)'), 'B6 (52)');
  assert.equal(normaliseBoxCode('\tFAT48\n'), 'FAT48');
});

test('a new box needs a code and a real port count', () => {
  const empty = emptyBoxDraft();
  const result = validateBoxDraft(empty, [], 'en');
  assert.ok(result.errors.box_code);
  assert.equal(result.duplicate, null);

  const tooLong = validateBoxDraft({ ...empty, box_code: 'X'.repeat(25) }, [], 'en');
  assert.ok(tooLong.errors.box_code);

  const badPorts = validateBoxDraft({ ...empty, box_code: 'FAT 1', total_ports: 7 }, [], 'so');
  assert.ok(badPorts.errors.total_ports);
});

test('a duplicate box is found regardless of spacing or case', () => {
  const existing = [{ id: 'box-1', box_code: 'FAT 48', xaafada: 'Masalaha' }];

  const duplicate = validateBoxDraft({ ...emptyBoxDraft(), box_code: 'fat   48' }, existing, 'en');
  assert.ok(duplicate.duplicate);
  assert.equal(duplicate.duplicate?.id, 'box-1');

  // Editing the same box is not a duplicate of itself.
  const editing = validateBoxDraft({ ...emptyBoxDraft(), id: 'box-1', box_code: 'FAT 48' }, existing, 'en');
  assert.equal(editing.duplicate, null);
});

/* -------------------------------------------------------------------------- */
/* Phone-in job                                                                */
/* -------------------------------------------------------------------------- */

test('a phone-in job needs a line and a name', () => {
  const result = validateManualTask(emptyManualDraft(), 'en');
  assert.ok(result.errors.line_number);
  assert.ok(result.errors.customer_name);

  const shortLine = validateManualTask({ ...emptyManualDraft(), line_number: '12', customer_name: 'A' }, 'en');
  assert.ok(shortLine.errors.line_number);
});

test('a phone number that cannot be dialled is caught before saving', () => {
  const bad = validateManualTask(
    { ...emptyManualDraft(), line_number: '6344771', customer_name: 'Cabdullaahi', customer_phone: '123' },
    'en',
  );
  assert.ok(bad.errors.customer_phone);

  const good = validateManualTask(
    { ...emptyManualDraft(), line_number: '6344771', customer_name: 'Cabdullaahi', customer_phone: '063 470 0000' },
    'en',
  );
  assert.equal(good.errors.customer_phone, undefined);
  assert.equal(good.payload.customer_phone, '0634700000', 'the tel: link is built from digits');
});

test('the payload matches what the RPC reads, including the assignment split', () => {
  const result = validateManualTask(
    {
      ...emptyManualDraft(),
      line_number: ' 6344771 ',
      customer_name: 'Cabdullaahi',
      task_type: 'installation',
      priority: 'urgent',
      box_code: 'fat 48',
      port_number: '3',
      assign_key: 'crew:crew-1',
    },
    'en',
  );

  assert.deepEqual(result.errors, {});
  assert.equal(result.payload.line_number, '6344771', 'trimmed');
  assert.equal(result.payload.box_code, 'FAT 48', 'normalised');
  assert.equal(result.payload.priority, 'urgent');
  assert.equal(result.payload.assign_crew_id, 'crew-1');
  assert.equal(result.payload.assign_user_id, undefined);

  const userAssigned = validateManualTask({ ...emptyManualDraft(), assign_key: 'user:user-9' }, 'en');
  assert.equal(userAssigned.payload.assign_user_id, 'user-9');
  assert.equal(userAssigned.payload.assign_crew_id, undefined);
});

test('a port outside 1–32 is rejected before the request', () => {
  const result = validateManualTask(
    { ...emptyManualDraft(), line_number: '6344771', customer_name: 'A', port_number: '33' },
    'so',
  );
  assert.ok(result.errors.port_number);
});

/* -------------------------------------------------------------------------- */
/* Cancelling                                                                  */
/* -------------------------------------------------------------------------- */

test('"other" stores exactly what was typed, the rest read as a sentence', () => {
  assert.equal(cancelReasonText('other', '  customer moved abroad ', 'en'), 'customer moved abroad');

  const readable = cancelReasonText('customer_request', '', 'en');
  assert.equal(readable, 'Customer cancelled the visit');

  const so = cancelReasonText('customer_request', '', 'so');
  assert.equal(so, 'Macmiilka ayaa joojiyay booqashada');

  const withNote = cancelReasonText('duplicate', 'same fault as F1-221', 'en');
  assert.match(withNote, /Already covered by another job — same fault as F1-221/);
});

test('every cancel reason exists in both languages', () => {
  for (const reason of CANCEL_REASONS) {
    assert.ok(reason.en.length > 0, `${reason.id} needs English`);
    assert.ok(reason.so.length > 0, `${reason.id} needs Somali`);
  }
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

const now = Date.parse('2026-11-01T10:00:00Z');
const minutesAgo = (minutes: number) => new Date(now - minutes * 60000).toISOString();

test('a technician is told about work that landed after they last looked', () => {
  const seenAt = now - 30 * 60000;

  const items = buildTechnicianNotifications({
    tasks: [
      { id: 'new-1', line_number: '6344771', customer_name: 'Ayaan', status: 'assigned', assigned_at: minutesAgo(5) },
      { id: 'old-1', line_number: '6344772', customer_name: 'Bashir', status: 'assigned', assigned_at: minutesAgo(90) },
      { id: 'running', line_number: '6344773', customer_name: 'Cumar', status: 'in_progress', assigned_at: minutesAgo(10) },
      { id: 'done', line_number: '6344774', customer_name: 'Deeq', status: 'completed', assigned_at: minutesAgo(1) },
    ],
    resumed: [],
    seenAt,
    lang: 'en',
  });

  assert.deepEqual(
    items.map((item) => item.id).sort(),
    ['new:new-1', 'new:running'],
    'only jobs assigned after the last look, and only open ones',
  );
});

test('a cleared blocker is news, and is not repeated as a new assignment', () => {
  const seenAt = now - 60 * 60000;

  const items = buildTechnicianNotifications({
    tasks: [
      { id: 't1', line_number: '6344771', customer_name: 'Ayaan', status: 'assigned', assigned_at: minutesAgo(120) },
      { id: 't2', line_number: '6344772', customer_name: 'Bashir', status: 'blocked', assigned_at: minutesAgo(1) },
    ],
    resumed: [
      { task_id: 't1', created_at: minutesAgo(15), notes: 'Fiber spliced' },
      { task_id: 't2', created_at: minutesAgo(15), notes: 'still blocked' },
    ],
    seenAt,
    lang: 'so',
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'blocker_cleared');
  assert.equal(items[0].taskId, 't1');
  assert.match(items[0].title, /Caqabadii/);
});

test('a supervisor sees blocked jobs and jobs running far too long', () => {
  const items = buildSupervisorNotifications({
    tasks: [
      { id: 'b1', line_number: '6344771', customer_name: 'Ayaan', status: 'blocked', blocker_reason: 'fiber_break', blocked_at: minutesAgo(20) },
      { id: 'l1', line_number: '6344772', customer_name: 'Bashir', status: 'in_progress', active_started_at: minutesAgo(190), worker: 'Cabdiraxmaan' },
      { id: 'ok', line_number: '6344773', customer_name: 'Cumar', status: 'in_progress', active_started_at: minutesAgo(30) },
    ],
    now,
    longMinutes: 120,
    lang: 'en',
  });

  assert.deepEqual(
    items.map((item) => item.id).sort(),
    ['blocked:b1', 'long:l1'],
  );
  assert.match(items.find((item) => item.id === 'blocked:b1')!.detail, /fiber break/);
  assert.match(items.find((item) => item.id === 'long:l1')!.title, /3h/);
});

test('search waits for a second character', () => {
  assert.equal(searchQueryIsUsable(' '), false);
  assert.equal(searchQueryIsUsable('9'), false);
  assert.equal(searchQueryIsUsable('FAT 48'), true);
});

/* -------------------------------------------------------------------------- */
/* Guards against a cancelled job leaking back into the work                   */
/* -------------------------------------------------------------------------- */

const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

test('open-work queries ask for the open statuses explicitly', () => {
  // `.neq('status','completed')` was correct before 'cancelled' existed. It now
  // silently pulls cancelled jobs back into the dispatch pool and the KPI count.
  assert.doesNotMatch(repo('src/lib/dispatchService.ts'), /neq\('status', 'completed'\)/);
  assert.doesNotMatch(repo('src/components/supervisor/SupervisorShell.tsx'), /neq\('status', 'completed'\)/);

  assert.match(repo('src/lib/dispatchService.ts'), /\.in\('status', OPEN_TASK_STATUSES\)/);
  assert.match(repo('src/components/supervisor/SupervisorShell.tsx'), /\.in\('status', OPEN_TASK_STATUSES\)/);
});

test('the importer does not treat a cancelled job as already open', () => {
  const importer = repo('src/lib/importer.ts');
  assert.match(importer, /t\.status !== 'completed' && t\.status !== 'cancelled'/);
});

test('the technician route never returns a cancelled job', () => {
  const migration = repo('supabase/migrations/010_batch_e_actions.sql');
  assert.match(migration, /tk\.status <> 'cancelled'/);
});

test('the cancelled state is enforced in the database, not only in the UI', () => {
  const lifecycle = repo('supabase/migrations/008_cancelled_lifecycle.sql');
  assert.match(lifecycle, /tasks_guard_cancelled/);
  assert.match(lifecycle, /f1\.allow_reopen/);

  const actions = repo('supabase/migrations/010_batch_e_actions.sql');
  assert.match(actions, /set_config\('f1\.allow_reopen', 'on', true\)/);
  assert.match(actions, /CREATE OR REPLACE FUNCTION public\.reopen_task/);
});

test('duplicate detection exists on both the box and the job', () => {
  const boxes = repo('supabase/migrations/009_batch_e_actions.sql');
  assert.match(boxes, /'reason', 'duplicate'/);
  assert.match(boxes, /CREATE OR REPLACE FUNCTION public\.create_manual_task/);
  assert.match(boxes, /p_allow_duplicate/);

  // And the screen offers the existing box instead of creating a twin.
  const editor = repo('src/components/registry/BoxEditorSheet.tsx');
  assert.match(editor, /validateBoxDraft/);
  assert.match(editor, /onOpenExisting/);
});

test('every new screen is reachable from a real entry point', () => {
  assert.match(repo('src/components/supervisor/dispatch/DispatchBoard.tsx'), /ManualTaskSheet/);
  assert.match(repo('src/components/supervisor/dispatch/DispatchBoard.tsx'), /JobActionsSheet/);
  assert.match(repo('src/components/supervisor/BoxRegistry.tsx'), /BoxEditorSheet/);
  assert.match(repo('src/components/HeaderBar.tsx'), /SearchPalette/);
  assert.match(repo('src/components/HeaderBar.tsx'), /NotificationsBell/);
  assert.ok(existsSync(fileURLToPath(new URL('../src/lib/navigation.tsx', import.meta.url))));
});
