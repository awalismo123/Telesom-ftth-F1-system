import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A design lint that runs with the unit tests.
 *
 * These are not style opinions — each rule is a measured accessibility floor
 * that regressed at least once during the build:
 *
 *   text-slate-400 on white = 2.8:1  (fails AA for text and for labels)
 *   text-slate-300 on white = 1.9:1  (decorative only, never words)
 *   text-[9px]              = below the legible floor on a 360 px phone
 *
 * A browser-based Lighthouse run is the full check; this keeps the cheap
 * mistakes from coming back between runs.
 */

const componentsDir = fileURLToPath(new URL('../src/components', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

const files = walk(componentsDir).map((path) => ({
  path: path.slice(path.indexOf('src/components')),
  source: readFileSync(path, 'utf8'),
}));

const occurrences = (pattern: RegExp) =>
  files.flatMap((file) =>
    (file.source.match(pattern) ?? []).map((token) => `${file.path}: ${token}`),
  );

test('found the component tree', () => {
  assert.ok(files.length >= 20, `expected the component tree, found ${files.length} files`);
});

test('no text uses a colour that fails AA on a light surface', () => {
  const offenders = occurrences(/text-slate-(300|400)\b/g);
  assert.deepEqual(
    offenders,
    [],
    'use text-slate-500 or darker for anything a person reads (slate-400 is 2.8:1 on white)',
  );
});

test('no text is smaller than 10px', () => {
  const tooSmall = (files.flatMap((file) => file.source.match(/text-\[(\d+)px\]/g) ?? []) as string[]).filter(
    (token) => Number(/\[(\d+)px\]/.exec(token)?.[1]) < 10,
  );
  assert.deepEqual(tooSmall, [], '9px is below the legible floor on a phone');
});

test('icon-only buttons carry an accessible name', () => {
  /*
   * Heuristic, deliberately conservative: only a button whose *entire* body is
   * a single element (no text, no JSX expression) counts as icon-only. A
   * false negative is fine; a false positive would force a useless change.
   */
  const offenders: string[] = [];

  for (const file of files) {
    const lines = file.source.split('\n');

    lines.forEach((line, index) => {
      if (!/<button\b/.test(line) || /aria-label|title=/.test(line)) return;

      const body = lines.slice(index, index + 12).join('\n');
      const openingTag = body.slice(0, body.indexOf('>') + 1);
      if (/aria-label|title=/.test(openingTag)) return;

      const inner = body.slice(body.indexOf('>') + 1, body.indexOf('</button>'));
      const stripped = inner.replace(/<[^>]*>/g, '').trim();

      if (stripped.length > 0) return; // contains text or {expression} → not icon-only
      if (!/^<[A-Z]/.test(inner.trim())) return; // empty button, not our business

      offenders.push(`${file.path}:${index + 1}`);
    });
  }

  assert.deepEqual(offenders, [], 'give icon-only controls an aria-label or title');
});
