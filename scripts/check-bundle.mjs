#!/usr/bin/env node
/**
 * Bundle budget — the acceptance test for Batch D.
 *
 * Reads the built `dist/index.html`, collects the chunks a *first* visit loads
 * (entry script + its static imports + CSS), gzips each, and fails if the total
 * is over budget. Lazy chunks — the OCR wizard, the analytics charts, the team
 * manager — are deliberately NOT counted: the point of the split is that a
 * technician reading their route never downloads them.
 *
 *   node scripts/check-bundle.mjs
 *
 * Run by `npm run verify` after `npm run build`.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const BUDGET_KB = 200;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[bundle] dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');

/** Every asset the browser needs before the app can paint. */
const referenced = [...new Set(html.match(/\/assets\/[a-zA-Z0-9._-]+\.(js|css)/g) ?? [])];
if (referenced.length === 0) {
  console.error('[bundle] no assets referenced from index.html.');
  process.exit(1);
}

/**
 * Rollup emits the entry chunk plus its *static* imports. They are all linked
 * from the entry via `import`, so walking `index-*.js` for `from"./x.js"`
 * would be exact — but the entry also preloads them via modulepreload links in
 * index.html. Take the html references (entry + css) and add the modulepreload
 * links, which Vite writes for exactly the static graph.
 */
const preloads = [...new Set(html.match(/\/assets\/[a-zA-Z0-9._-]+\.js/g) ?? [])];
const firstLoad = [...new Set([...referenced, ...preloads])];

let totalGzip = 0;
const rows = [];

for (const asset of firstLoad) {
  const path = join(DIST, asset.replace(/^\//, ''));
  if (!existsSync(path)) continue;

  const buffer = readFileSync(path);
  const gzip = gzipSync(buffer, { level: 9 }).length;
  totalGzip += gzip;
  rows.push({
    name: asset.replace('/assets/', ''),
    raw: buffer.length,
    gzip,
  });
}

rows.sort((a, b) => b.gzip - a.gzip);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

console.log('[bundle] first load:');
for (const row of rows) {
  console.log(`  ${row.name.padEnd(34)} ${kb(row.raw).padStart(10)}  →  ${kb(row.gzip).padStart(9)} gzip`);
}
console.log(`[bundle] total ${kb(totalGzip)} gzip (budget ${BUDGET_KB} kB)`);

/** Report what is waiting behind a tap, without failing on it. */
const lazy = html.match(/modulepreload/g) ?? [];
void lazy;

if (totalGzip > BUDGET_KB * 1024) {
  console.error(
    `\n[bundle] OVER BUDGET by ${kb(totalGzip - BUDGET_KB * 1024)}.\n` +
      'Move a screen behind React.lazy() rather than raising the budget.',
  );
  process.exit(1);
}

console.log('[bundle] within budget ✓');
