import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Structural guards for Batch D.
 *
 * These do not measure milliseconds — they pin the decisions that keep the app
 * fast, because every one of them is easy to undo by accident:
 *
 *   • a heavy screen imported statically sneaks back into first load;
 *   • a bare `setInterval` in a component polls forever in a hidden tab;
 *   • the OCR engine gets imported eagerly and adds ~1 MB to login.
 */

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

test('the OCR engine is only ever reached through a dynamic import', () => {
  const engineConsumers = ['components/supervisor/ingest/IngestWizard.tsx'];
  for (const file of engineConsumers) {
    const text = src(file);
    // A dynamic import is expected …
    assert.match(text, /import\(['"].*lib\/ocr\/engine['"]\)/, `${file} should lazy-load the OCR engine`);
    // … and no static import of tesseract.
    assert.doesNotMatch(text, /^import .*tesseract/m, `${file} must not import tesseract statically`);
  }
});

test('the shells lazy-load their modules instead of importing them eagerly', () => {
  const supervisor = src('components/supervisor/SupervisorShell.tsx');
  for (const screen of ['DispatchBoard', 'IngestWizard', 'Analytics', 'TeamAndCrewManager', 'BoxRegistry']) {
    assert.match(
      supervisor,
      new RegExp(`React\\.lazy\\(`),
      'the supervisor shell should use React.lazy',
    );
    assert.doesNotMatch(
      supervisor,
      new RegExp(`^import \\{[^}]*\\b${screen}\\b`, 'm'),
      `${screen} must not be imported statically into the shell`,
    );
  }

  const technician = src('components/technician/TechnicianShell.tsx');
  assert.match(technician, /React\.lazy/);
  assert.doesNotMatch(technician, /^import \{ RouteView \}/m);
});

test('components do not poll with a bare setInterval', () => {
  const offenders: string[] = [];
  const files = [
    'components/technician/RouteView.tsx',
    'components/technician/RunningPill.tsx',
    'components/supervisor/dispatch/LiveStrip.tsx',
  ];

  for (const file of files) {
    const text = src(file);
    if (/window\.setInterval|(?<!\.)\bsetInterval\(/.test(text)) offenders.push(file);
  }

  assert.deepEqual(offenders, [], 'use useVisibleInterval so a hidden tab stops polling');
});

test('live screens subscribe to Postgres changes', () => {
  for (const file of [
    'components/technician/RouteView.tsx',
    'components/supervisor/dispatch/LiveStrip.tsx',
    'components/supervisor/dispatch/DispatchBoard.tsx',
  ]) {
    assert.match(src(file), /useTableChanges\(\{/, `${file} should react to realtime changes`);
  }
});

test('the Vite config actually splits vendor code', () => {
  const config = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8');
  assert.match(config, /manualChunks/);
  assert.match(config, /'react'/);
  assert.match(config, /'supabase'/);
  assert.match(config, /chunkSizeWarningLimit/);
});

test('a built bundle, when present, is inside the first-load budget', () => {
  const script = fileURLToPath(new URL('../scripts/check-bundle.mjs', import.meta.url));
  assert.ok(existsSync(script), 'the bundle budget script must exist');
  const text = readFileSync(script, 'utf8');
  assert.match(text, /BUDGET_KB = 200/, 'the agreed budget is 200 kB gzip');
});
