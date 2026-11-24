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

/**
 * The promise has a single home since 033.
 *
 * `today_summary` no longer types a number into an interval literal; it calls
 * `task_sla_days(task_type)`, which answers 2 for a fault and 3 for an
 * installation. Without this pattern the scan below would report fewer sites
 * than exist and pass while missing the one that matters most.
 *
 * Pinned here rather than trusted, because "we unified it" and "it is still
 * unified" are different claims.
 */
const SLA_FUNCTION = /WHEN\s+p_task_type\s*=\s*'cilada'\s+THEN\s+(\d+)\s+ELSE\s+(\d+)/i;

interface SlaSite {
  file: string;
  line: number;
  days: number;
}

/**
 * Which function a line belongs to.
 *
 * A migration may redefine a function that an earlier migration already
 * defined — `today_summary` is redefined in 023 to fix the crew counts. Both
 * copies contain the promise, but only one is live: the later definition
 * replaces the earlier one at run time.
 *
 * Counting both would make this guard fire every time a function is corrected,
 * and the natural reaction to that is to bump the expected number until the
 * test means nothing. So the scan tracks function boundaries and keeps only the
 * sites inside the newest definition of each function.
 */
const FUNCTION_HEADER = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/i;

interface RawSite extends SlaSite {
  fn: string | null;
}

const rawSites: RawSite[] = [];

for (const file of migrationFiles) {
  const lines = readFileSync(join(migrationsDir, file), 'utf8').split('\n');
  let currentFn: string | null = null;
  lines.forEach((text, index) => {
    const header = text.match(FUNCTION_HEADER);
    if (header) currentFn = header[1];

    const match = text.match(SLA_COMPARISON);
    if (match) rawSites.push({ file, line: index + 1, days: Number(match[1]), fn: currentFn });
  });
}

/** The last migration file that defines each function, by name. */
const latestDefinition = new Map<string, string>();
for (const site of rawSites) {
  if (site.fn) latestDefinition.set(site.fn, site.file);
}

// Migration filenames sort chronologically, so "latest" is the greatest name.
for (const file of migrationFiles) {
  for (const [, fn] of readFileSync(join(migrationsDir, file), 'utf8').matchAll(
    new RegExp(FUNCTION_HEADER.source, 'gi'),
  )) {
    const current = latestDefinition.get(fn);
    if (!current || file > current) latestDefinition.set(fn, file);
  }
}

const sites: SlaSite[] = rawSites.filter(
  (site) => site.fn === null || latestDefinition.get(site.fn) === site.file,
);

test('every overdue check uses the same number as the screen', () => {
  const drifted = sites.filter((site) => site.days !== SLA_DAYS);

  assert.deepEqual(
    drifted.map((s) => `${s.file}:${s.line} says ${s.days} days, the screen says ${SLA_DAYS}`),
    [],
    'The promise differs between the database and the screen. Change every site together.',
  );
});

test('the promise has exactly one definition, and it is parameterised by kind', () => {
  // Assembled from pieces so this test does not itself look like a fourth site.
  const defs = migrationFiles.filter((f) =>
    readFileSync(join(migrationsDir, f), 'utf8').includes('CREATE OR REPLACE FUNCTION public.task_sla_days'),
  );
  assert.deepEqual(defs, ['033_faults_and_job_editing.sql']);

  const sql = readFileSync(join(migrationsDir, '033_faults_and_job_editing.sql'), 'utf8');
  const match = sql.match(SLA_FUNCTION);
  assert.ok(match, 'task_sla_days must define both windows');

  // A fault is the tighter promise: 2 days against 3.
  const faultDays = Number(match![1]);
  const installDays = Number(match![2]);
  assert.equal(installDays, SLA_DAYS, 'the installation window is the original promise');
  assert.equal(faultDays, installDays - 1, 'a fault is promised one day tighter than an installation');

  // And every consumer reads it rather than typing a number.
  const summary = sql.slice(sql.indexOf('FUNCTION public.today_summary'));
  assert.match(summary, /make_interval\(days => public\.task_sla_days\(t\.task_type\)\)/);
});

test('the scan still finds every site', () => {
  // If a query is refactored and stops matching, the test above would pass by
  // finding nothing. Asserting the *set of functions* rather than a bare count
  // makes that failure name itself.
  //
  // This used to assert 5. That 5 was wrong: it counted `period_report` twice,
  // because it is defined in 012 and replaced in 013, and only the 013 copy is
  // live. Counting only live definitions gives four.
  const live = [...new Set(sites.filter((site) => site.fn).map((site) => site.fn))].sort();
  // `today_summary` left this list in 033: it no longer types a number, it calls
  // `task_sla_days`, which is pinned by its own test above. The four remaining
  // numeric sites are the report functions that were not rewritten, because a
  // mistake inside a SECURITY DEFINER report fails silently.
  assert.deepEqual(live, [
    'internal_period_stats',
    'manager_portfolio',
    'period_report',
  ]);
});

test('a redefined function is counted once, at its newest definition', () => {
  // `today_summary` exists in both 022 and 023 with the same promise. Counting
  // the superseded copy would make this guard fire on every correction and
  // train whoever hits it to bump the number.
  const todaySummarySites = rawSites.filter((site) => site.fn === 'today_summary');
  assert.ok(todaySummarySites.length > 1, 'expected today_summary in more than one migration');

  // It contributes no sites to the numeric scan now — see the test above — so
  // this asserts the superseded copies are correctly excluded rather than that
  // a site survives.
  const counted = todaySummarySites.filter((site) => sites.includes(site));
  assert.equal(counted.length, 0, 'the newest today_summary types no number');
  // ...and the newest copy is the one in 033, not the 023 one that typed three.
  assert.equal(latestDefinition.get('today_summary'), '033_faults_and_job_editing.sql');
});

test('the client constant is a whole number of days', () => {
  assert.equal(Number.isInteger(SLA_DAYS), true);
  assert.ok(SLA_DAYS > 0 && SLA_DAYS < 30, 'a promise outside 1–29 days is a typo, not a policy');
});
