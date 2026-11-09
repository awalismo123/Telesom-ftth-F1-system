/**
 * The audit's P0, as a test.
 *
 * Six seeded accounts signed in with `1234` / `1111`. The PINs were in the
 * README, and — because `import.meta.env.DEV` removed the *panel* but not the
 * data it closed over — the `{ identifier, pin }` array survived minification
 * inside the production bundle.
 *
 * `scripts/check-credentials.mjs` inspects the built artifact, which is the real
 * defence. These tests cover the source, so the failure arrives in a second
 * rather than after a build, and so the wiring itself cannot be quietly dropped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'src');

const sourceFiles: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
})(src);

const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * Comments do not ship — Vite strips them — so they are excluded from the scan.
 * The examples in `dispatch.ts` (`634418376` → `063 441 8376`) are the whole
 * point of those doc comments, and flagging them would push someone to weaken
 * the rule rather than fix a real leak.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('no source file embeds a credential pair', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    // `pin: '1234'` / `pin: "1111"` — the shape of the deleted quick-fill array.
    const matches = text.match(/\bpin\s*:\s*['"]\d{4,6}['"]/gi) ?? [];
    if (matches.length > 0) offenders.push(`${file}: ${matches.join(', ')}`);
  }

  assert.deepEqual(
    offenders,
    [],
    'A PIN literal is in the source. Credentials belong in the database, never in the app.',
  );
});

test('the login screen no longer ships quick-fill accounts', () => {
  const login = read('src/components/LoginScreen.tsx');
  assert.equal(/QUICK_ACCOUNTS/.test(login), false, 'QUICK_ACCOUNTS is back in LoginScreen');
  assert.equal(
    /\bidentifier\s*:\s*['"]/.test(login),
    false,
    'LoginScreen declares an identifier literal again',
  );
});

test('no real Telesom subscriber number is hardcoded in the app', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles) {
    const text = stripComments(readFileSync(file, 'utf8'));
    // 63 + 7 digits. The seeded technicians were 634100101-104.
    const matches = text.match(/\b63[2-9]\d{6}\b/g) ?? [];
    if (matches.length > 0) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
  }

  assert.deepEqual(
    offenders,
    [],
    'A real subscriber number is in the source. Use a masked example (63X XXX XXX).',
  );
});

test('the login placeholder does not name a seeded account', () => {
  const i18n = read('src/lib/i18n.tsx');
  const placeholders = i18n.match(/identifierPlaceholder:\s*'([^']*)'/g) ?? [];

  assert.equal(placeholders.length, 2, 'expected an English and a Somali placeholder');

  for (const line of placeholders) {
    assert.equal(
      /\d/.test(line),
      false,
      `placeholder contains a number: ${line} — a real technician's number was printed here`,
    );
  }
});

test('the credential guard is wired into the build gate', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  assert.ok(existsSync(join(root, 'scripts/check-credentials.mjs')), 'guard script is missing');
  assert.match(
    pkg.scripts['bundle:check'],
    /check-credentials\.mjs/,
    'bundle:check does not run the credential guard',
  );
  assert.match(
    pkg.scripts.verify,
    /bundle:check/,
    'npm run verify does not run the credential guard',
  );
});
