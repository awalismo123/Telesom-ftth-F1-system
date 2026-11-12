/**
 * The demo disclosure.
 *
 * With demo history loaded, `period_report` says "44 created, 39 completed" and
 * `manager_portfolio` says 39 — both true, both inflated by 36 synthetic jobs,
 * and both silent about it. The Insights screen had a banner; the two documents
 * that get printed and filed did not.
 *
 * These tests pin the sentence, both languages and the silent case. The silent
 * case matters as much as the others: an app that warns about demo data when
 * there is none trains people to ignore the warning.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  demoChipLabel,
  demoNotice,
  hasDemoData,
  portfolioDemoNotice,
  type DemoSummary,
} from '../src/lib/demo';

const summary = (over: Partial<DemoSummary> = {}): DemoSummary => ({
  tasks: 36,
  tasks_total: 44,
  logs: 38,
  logs_total: 38,
  from: '2026-10-14',
  to: '2026-11-12',
  ...over,
});

test('nothing is said when there is no demo data', () => {
  assert.equal(demoNotice(summary({ tasks: 0 }), 'en'), null);
  assert.equal(demoNotice(summary({ tasks: 0 }), 'so'), null);
  assert.equal(demoNotice(null, 'en'), null);
  assert.equal(portfolioDemoNotice(summary({ tasks: 0 }), 'en'), null);
  assert.equal(demoChipLabel(summary({ tasks: 0 }), 'so'), null);
  assert.equal(hasDemoData(summary({ tasks: 0 })), false);
});

test('the report sentence names both numbers, in both languages', () => {
  const en = demoNotice(summary(), 'en');
  const so = demoNotice(summary(), 'so');

  assert.ok(en && so);
  assert.match(en, /36 of 44/);
  assert.match(so, /36 ka mid ah 44/);
  assert.notEqual(en, so, 'the two languages must not be the same string');
});

test('the wording tells the reader what to do', () => {
  // "36 of 44 are demo" alone still leaves a manager unsure whether they may
  // file it. The sentence has to carry the instruction.
  assert.match(demoNotice(summary(), 'en') ?? '', /before filing/i);
  assert.match(demoNotice(summary(), 'so') ?? '', /ka hor inta aanad gudbin/i);
});

test('the portfolio sentence says the group figures are affected', () => {
  const en = portfolioDemoNotice(summary(), 'en') ?? '';
  const so = portfolioDemoNotice(summary(), 'so') ?? '';

  assert.match(en, /window/);
  assert.match(en, /group figures/i);
  assert.match(so, /xilligan/);
  assert.match(so, /kooxaha/);
});

test('a fully demo window is still reported honestly', () => {
  // 44 of 44 — the sentence must not read "0 of 44" or drop the total.
  const all = demoNotice(summary({ tasks: 44, tasks_total: 44 }), 'en') ?? '';
  assert.match(all, /44 of 44/);
});

test('a count larger than the total is not swallowed', () => {
  // Should be impossible from the SQL (both counts share a window and scope),
  // but a label that renders "50 of 44" without complaint would hide the bug
  // that produced it rather than surface it.
  const odd = demoNotice(summary({ tasks: 50, tasks_total: 44 }), 'en') ?? '';
  assert.match(odd, /50 of 44/);
});

/* -------------------------------------------------------------------------- */
/* The wiring                                                                  */
/* -------------------------------------------------------------------------- */
/*
 * The sentence is worth nothing if the screens stop calling it. These read the
 * source, in the same spirit as the i18n test: cheap, and they fail on the day
 * someone refactors the label away rather than the day an auditor notices.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const source = (path: string) => readFileSync(join(src, path), 'utf8');

test('the period report fetches and renders the demo count', () => {
  const sheet = source('components/supervisor/PeriodReportSheet.tsx');

  assert.match(sheet, /fetchDemoSummary/, 'the report no longer asks how much is demo');
  assert.match(sheet, /demoNotice\(/, 'the report no longer renders the disclosure');
});

test('the manager portfolio fetches and renders the demo count', () => {
  const portfolio = source('components/manager/Portfolio.tsx');

  assert.match(portfolio, /fetchDemoSummary/, 'the portfolio no longer asks how much is demo');
  assert.match(portfolio, /portfolioDemoNotice\(/, 'the portfolio no longer renders the disclosure');
});
