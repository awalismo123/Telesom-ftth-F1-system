/**
 * The service promise is written down five times.
 *
 * `SLA_DAYS` in the client paints a job amber on day three and rose after it.
 * Four SQL report functions decide which jobs count as over the line, each with
 * the number typed into an interval literal. The audit found two of those sites;
 * there are five.
 *
 * Unifying them properly means rewriting four `SECURITY DEFINER` report
 * functions to swap a constant that already agrees — and a mistake there breaks
 * the supervisor's daily report silently, which is a far worse outcome than the
 * duplication. So the duplication stays and is *pinned*: one number, checked
 * against every site, failing the build if any drifts.
 *
 * A first version of this test scanned every `interval 'N days'` in the
 * migrations and reported six false failures — demo history (30 days), the
 * session window (14), "since yesterday" cutoffs (1). The promise is not every
 * interval in the schema; it is the one that computes `waiting_over_sla`. This
 * version anchors on that name and looks forward from it.
 *
 * What it cannot see: a function edited directly in the SQL editor drifts
 * without this noticing. That is why a change to the promise is a migration
 * plus this test, never a live edit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { SLA_DAYS } from '../src/lib/activity';

const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

/**
 * What counts as a site.
 *
 * The promise is always written the same way: a task timestamp compared against
 * a window subtracted from a reference time — "older than three days from the
 * day it arrived".
 *
 *   t.created_at < v_to_ts - interval '3 days'
 *
 * Everything else in the schema that uses an interval is a different question
 * and must not be dragged in: the session window (14 days), demo history
 * (30), "since yesterday" cutoffs (1), and the day-bucketing in the report
 * charts (`d + interval '1 day'`, which is a `+` and a lower bound, not a
 * deadline).
 */
const SLA_COMPARISON = /<[^;\n]*-\s*interval\s+'(\d+)\s+days?'/i;

interface SlaSite {
  file: string;
  line: number;
  days: number;
}

const sites: SlaSite[] = [];

for (const file of migrationFiles) {
  const lines = readFileSync(join(migrationsDir, file), 'utf8').split('\n');
  lines.forEach((text, index) => {
    const match = text.match(SLA_COMPARISON);
    if (match) sites.push({ file, line: index + 1, days: Number(match[1]) });
  });
}

test('every overdue check uses the same number as the screen', () => {
  const drifted = sites.filter((site) => site.days !== SLA_DAYS);

  assert.deepEqual(
    drifted.map((s) => `${s.file}:${s.line} says ${s.days} days, the screen says ${SLA_DAYS}`),
    [],
    'The promise differs between the database and the screen. Change every site together.',
  );
});

test('the scan still finds every site', () => {
  // If a query is refactored and stops matching, the test above would pass by
  // finding nothing. Four report functions make this comparison.
  assert.equal(
    sites.length,
    4,
    `expected 4 overdue checks, found ${sites.length}. ` +
      'If one was intentionally added or removed, update this count with it.',
  );
});

test('the client constant is a whole number of days', () => {
  assert.equal(Number.isInteger(SLA_DAYS), true);
  assert.ok(SLA_DAYS > 0 && SLA_DAYS < 30, 'a promise outside 1–29 days is a typo, not a policy');
});
