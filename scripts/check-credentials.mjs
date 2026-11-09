#!/usr/bin/env node
/**
 * Credential guard — the regression test for the audit's P0-1.
 *
 * The department PINs reached production the quiet way: a `DEV_BUILD` flag
 * compiled the quick-fill *panel* out of the bundle, so nothing on screen looked
 * wrong, while the array holding `{ identifier, pin }` survived minification as
 * unreachable data. Anyone who opened the JS file, or the README, had six logins.
 *
 * `import.meta.env.DEV` is the wrong tool for credentials, because it only
 * removes the code that *renders* the data. This script checks the artifact
 * instead of the intention: if a PIN-shaped literal, a seeded identifier or a
 * real technician number appears in anything we are about to publish, the build
 * fails here rather than in an audit three weeks later.
 *
 *   node scripts/check-credentials.mjs
 *
 * Runs as part of `npm run bundle:check`, and in CI after `npm run build`.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('[creds] dist/ not found — run `npm run build` first.');
  process.exit(1);
}

/** Every file we would actually serve. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|css|html|json|txt|map)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(DIST).filter((f) => statSync(f).size > 0);

/**
 * Patterns that must never ship.
 *
 * Deliberately narrow. A loose `\d{4}` rule would fire on timestamps, chunk
 * sizes and colour values; these three catch the actual leak and stay quiet.
 */
const RULES = [
  {
    name: 'hardcoded PIN object',
    // `pin:"1111"` / `pin:'1234'` — the shape the quick-fill array minified into.
    re: /\bpin\s*:\s*["']\d{4,6}["']/gi,
    why: 'A credential pair is embedded in the bundle. Never ship a PIN, even behind a flag.',
  },
  {
    name: 'seeded department identifier',
    // The demo logins: supervisor, maamule, cabdi, xasan, maxamed, mustafe.
    re: /\b(?:identifier|username)\s*:\s*["'](?:supervisor|maamule|cabdi|xasan|maxamed|mustafe)["']/gi,
    why: 'A seeded account name is embedded in the bundle.',
  },
  {
    name: 'real Telesom subscriber number',
    // 63 + 7 digits. The seeded technicians are 634100101-103.
    re: /\b63[2-9]\d{6}\b/g,
    why: 'A real subscriber number is embedded in the bundle. Use a masked example (63X XXX XXX).',
  },
];

let failures = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const hits = [...new Set((text.match(rule.re) ?? []).map((m) => m.trim()))];
    if (hits.length === 0) continue;

    failures += hits.length;
    console.error(
      `\n[creds] ${file.replace(`${ROOT}/`, '')}\n` +
        `  ${rule.name}: ${hits.join(', ')}\n` +
        `  ${rule.why}`,
    );
  }
}

if (failures > 0) {
  console.error(
    `\n[creds] FAILED — ${failures} credential literal${failures === 1 ? '' : 's'} in dist/.` +
      '\n  Remove the literal from source; do not add an ignore rule to silence this.',
  );
  process.exit(1);
}

console.log(`[creds] clean — no credential literals in ${files.length} built file(s) ✓`);
