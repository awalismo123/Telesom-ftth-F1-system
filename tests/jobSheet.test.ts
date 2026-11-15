import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  HEALTHY_WINDOW,
  SHEET_NOTE,
  dbmAssessment,
  filledCount,
  jobReference,
  sheetFields,
  typeLabel,
} from '../src/lib/jobSheet';
import type { RouteTask } from '../src/lib/execution';

/**
 * A printed job sheet is read at a door, by somebody who cannot ask questions.
 * The tests pin the two things that matter: the port and the reading are on it,
 * and a field nobody filled in is **absent** rather than a dash.
 */

const task = (over: Partial<RouteTask> = {}): RouteTask =>
  ({
    id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
    line_number: '575373',
    customer_name: 'HOODO IDIRIS MAXAMED',
    customer_phone: '0634111111',
    task_type: 'cilada',
    status: 'assigned',
    priority: 'normal',
    reported_date: '2026-11-12',
    xaafada: 'JIGJIGAYAR',
    cablebox_code_raw: 'FAT48',
    port_number: 7,
    optical_dbm: -21.5,
    completion_notes: 'replaced the drop cable',
    blocker_reason: null,
    active_started_at: null,
    completed_at: null,
    accumulated_seconds: 600,
    ...over,
  }) as RouteTask;

const labels = (fields: ReturnType<typeof sheetFields>) => fields.map((f) => f.label);
const valueOf = (fields: ReturnType<typeof sheetFields>, label: string) =>
  fields.find((f) => f.label === label)?.value;

/* -------------------------------------------------------------------------- */
/* The two things the sheet exists for                                        */
/* -------------------------------------------------------------------------- */

test('the sheet carries the port number', () => {
  assert.equal(valueOf(sheetFields(task(), 'en'), 'Port'), '7');
});

test('the sheet carries the dBm reading', () => {
  const text = valueOf(sheetFields(task(), 'en'), 'dBm reading');
  assert.ok(text);
  assert.match(text!, /-21\.50 dBm/);
});

test('the reading is judged against the app-wide healthy window', () => {
  // There is no per-job numeric target in the database; inventing one would be
  // worse than saying which window the app already uses.
  assert.deepEqual(HEALTHY_WINDOW, { from: -27, to: -8 });
  assert.match(dbmAssessment(task({ optical_dbm: -21.5 }), 'en')!, /healthy -27 … -8 dBm/);
});

test('a weak reading is called weak, not merely printed', () => {
  assert.match(dbmAssessment(task({ optical_dbm: -30 }), 'en')!, /too weak/);
});

test('a too-strong reading is called out as well', () => {
  // Over-strong is a real fault too: it usually means an amplifier problem.
  assert.match(dbmAssessment(task({ optical_dbm: -6 }), 'en')!, /too strong/);
});

test('no reading means no row at all', () => {
  assert.equal(dbmAssessment(task({ optical_dbm: null }), 'en'), null);
  assert.equal(valueOf(sheetFields(task({ optical_dbm: null }), 'en'), 'dBm reading'), undefined);
});

/* -------------------------------------------------------------------------- */
/* Empty fields are absent, not dashes                                        */
/* -------------------------------------------------------------------------- */

test('an empty field is omitted rather than printed as a dash', () => {
  // A sheet full of dashes teaches the reader that dashes are noise, and then a
  // genuinely missing port looks like everything else.
  const fields = sheetFields(
    task({ xaafada: null, cablebox_code_raw: '', customer_phone: '   ', port_number: null }),
    'en',
  );
  const all = labels(fields);
  assert.ok(!all.includes('Area'));
  assert.ok(!all.includes('Cable box'));
  assert.ok(!all.includes('Phone'));
  assert.ok(!all.includes('Port'));
  for (const field of fields) {
    assert.notEqual(field.value, '—');
    assert.notEqual(field.value.trim(), '');
  }
});

test('port 0 is not a port', () => {
  assert.equal(valueOf(sheetFields(task({ port_number: 0 }), 'en'), 'Port'), undefined);
});

test('a job with nothing recorded prints an almost empty sheet, not a page of dashes', () => {
  const bare = sheetFields(
    task({
      customer_name: null,
      customer_phone: null,
      xaafada: null,
      cablebox_code_raw: null,
      port_number: null,
      optical_dbm: null,
      completion_notes: null,
      blocker_reason: null,
      reported_date: null,
      accumulated_seconds: 0,
    }),
    'en',
  );
  // Line number and job type are always present.
  assert.ok(filledCount(bare) <= 2);
});

test('every field that survives carries a non-blank value', () => {
  for (const lang of ['en', 'so'] as const) {
    for (const field of sheetFields(task(), lang)) {
      assert.ok(field.value.trim().length > 0, `blank value for ${field.label}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Times and durations                                                        */
/* -------------------------------------------------------------------------- */

test('a zero duration is not printed as "0 min"', () => {
  // The job has not run yet; "0 min" reads like it was instantaneous.
  assert.equal(valueOf(sheetFields(task({ accumulated_seconds: 0 }), 'en'), 'Time on job'), undefined);
});

test('a duration over an hour reads in hours', () => {
  assert.equal(
    valueOf(sheetFields(task({ accumulated_seconds: 3720 }), 'en'), 'Time on job'),
    '1h 2m',
  );
});

test('a short duration reads in minutes', () => {
  assert.equal(valueOf(sheetFields(task({ accumulated_seconds: 420 }), 'en'), 'Time on job'), '7 min');
});

test('an unparseable timestamp is omitted rather than printed as Invalid Date', () => {
  const fields = sheetFields(task({ completed_at: 'not-a-date' }), 'en');
  assert.equal(valueOf(fields, 'Completed'), undefined);
});

/* -------------------------------------------------------------------------- */
/* Ordering and labels                                                        */
/* -------------------------------------------------------------------------- */

test('the sheet reads who, then where, then what', () => {
  const all = labels(sheetFields(task(), 'en'));
  assert.ok(all.indexOf('Customer') < all.indexOf('Area'));
  assert.ok(all.indexOf('Area') < all.indexOf('Job type'));
  assert.ok(all.indexOf('Job type') < all.indexOf('Time on job'));
});

test('job types are translated and unknown types are shown as-is', () => {
  assert.equal(typeLabel('cilada', 'en'), 'Fault');
  assert.equal(typeLabel('installation', 'so'), 'Rakid');
  assert.equal(typeLabel('relocation', 'en'), 'relocation');
});

test('urgent is only printed when the job is urgent', () => {
  assert.equal(valueOf(sheetFields(task({ priority: 'urgent' }), 'en'), 'Priority'), 'Urgent');
  assert.equal(valueOf(sheetFields(task({ priority: 'normal' }), 'en'), 'Priority'), undefined);
});

test('the note says a blocker pauses the clock', () => {
  // The times on the paper must not be read as "how long the technician took".
  assert.match(SHEET_NOTE.en, /blocker pauses the clock/i);
  assert.match(SHEET_NOTE.so, /caqabaddu way joojisaa/i);
});

test('the job reference is short and stable', () => {
  const ref = jobReference('aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(ref, '#AAAAAAAA');
  assert.equal(jobReference('aaaaaaaabbbbccccddddeeeeeeeeeeee'), ref);
});

/* -------------------------------------------------------------------------- */
/* The paper must not carry the app behind it                                 */
/* -------------------------------------------------------------------------- */

const view = readFileSync(
  fileURLToPath(new URL('../src/components/technician/JobSheetPrint.tsx', import.meta.url)),
  'utf8',
);

test('the print view is marked print-root', () => {
  // index.css hides `> #root` only while a `.print-root` is on the page. Without
  // this the paper carries a screenshot of the app behind the sheet.
  assert.match(view, /print-root/);
});

test('the toolbar is excluded from paper', () => {
  assert.match(view, /no-print/);
});

test('printing is an explicit action, never automatic', () => {
  // A job sheet carries a name, phone and address. It must never print on its
  // own, and there must be no bulk print.
  assert.match(view, /window\.print\(\)/);
  assert.doesNotMatch(view, /useEffect\(\(\) => \{\s*window\.print/);
  assert.doesNotMatch(view, /printAll|print-all/i);
});
