import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Brand integrity.
 *
 * Two classes of mistake this exists to stop, both of which already happened
 * once during the redesign:
 *
 *  1. The brand colour being "tidied" into something that looks nicer and is
 *     no longer Telesom's. `#389955` is sampled from the wordmark; it is not a
 *     design choice and it is not open to improvement.
 *  2. The emblem being edited in one of its four copies (the SVG asset, the
 *     favicon, the React component, the icon generator) and drifting from the
 *     other three. It is one drawing in four encodings.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const css = read('../src/index.css');

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|css)$/.test(full) ? [full] : [];
  });
}

// ── Colour ─────────────────────────────────────────────────────────────────

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const token = (name: string): string => {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(match, `token --color-${name} is missing from index.css`);
  return match[1].toLowerCase();
};

test('the brand green is the colour sampled from the logo, exactly', () => {
  // Sampled from the "Telesom" wordmark: #389955, Chateau Green. Changing this
  // value makes the app stop matching the company's own materials.
  assert.equal(token('brand-600'), '#389955');
});

test('the gold and the blue are the sampled values too', () => {
  // Gold is the most consistent colour across every Telesom logo variant.
  assert.equal(token('gold-400'), '#f8dc09');
  // The orbit blue. The published brand palette omits it entirely, which is
  // why it was measured off the artwork instead of trusted from a directory.
  assert.equal(token('ink-600'), '#313195');
});

test('white text on a brand fill clears AA', () => {
  // The exact brand green is 3.58:1 against white — below AA for the 11 px
  // labels this app puts on solid green (the "Running" strip, "Job completed",
  // the back-online banner). So text-bearing surfaces use brand-700 at 6.2:1.
  // brand-600 stays for the logo, borders, icons and pure fills.
  assert.ok(contrast('#ffffff', token('brand-700')) >= 4.5, 'white on brand-700 must clear 4.5:1');
  assert.ok(contrast('#ffffff', token('brand-800')) >= 4.5, 'white on brand-800 must clear 4.5:1');
});

test('no text sits on brand-600 — it is 3.58:1 and carries no words', () => {
  // A lint, not a comment. Six surfaces were on this fill when the brand was
  // introduced; every one of them had text on it.
  const offenders = walk(srcDir).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const hits = source.match(/bg-brand-600[^'"`]*text-white|text-white[^'"`]*bg-brand-600/g) ?? [];
    return hits.map((hit) => `${path.slice(path.indexOf('src/'))}: ${hit.trim()}`);
  });
  assert.deepEqual(offenders, [], 'use bg-brand-700 behind white text (3.58:1 vs 6.2:1)');
});

test('brand-700 is dark enough to be body text on white', () => {
  assert.ok(contrast(token('brand-700'), '#ffffff') >= 4.5);
});

test('brand-500 is a fill, not a text colour — and the ramp knows it', () => {
  // Documented so the constraint is executable rather than a comment: the
  // mid green is used for surfaces and charts, never for words on light.
  assert.ok(
    contrast(token('brand-500'), '#ffffff') < 4.5,
    'if brand-500 ever passes AA on white, revisit docs/BRAND.md — the rule below it changes',
  );
});

test('the ramp kept every shade at the luminance it replaced', () => {
  // The migration swapped Tailwind emerald for Telesom green across 47 files.
  // It was safe only because each brand shade sits at the same relative
  // luminance as the emerald of the same number, so no contrast ratio in the
  // app changed — only the hue. If someone re-tunes a shade, this catches it.
  const emerald: Record<number, number> = {
    50: 0.9468, 100: 0.8758, 200: 0.7687, 300: 0.6389, 400: 0.4962,
    500: 0.3639, 600: 0.2286, 700: 0.1415, 800: 0.0867, 900: 0.058,
    950: 0.0193,
  };
  for (const [shade, expected] of Object.entries(emerald)) {
    const actual = relativeLuminance(token(`brand-${shade}`));
    assert.ok(
      Math.abs(actual - Number(expected)) < 0.02,
      `brand-${shade} has luminance ${actual.toFixed(4)}, expected ~${expected}`,
    );
  }
});

test('no Tailwind emerald utility is left behind', () => {
  const offenders = walk(srcDir).flatMap((path) => {
    const hits = readFileSync(path, 'utf8').match(/emerald-\d{2,3}/g) ?? [];
    return hits.map((hit) => `${path.slice(path.indexOf('src/'))}: ${hit}`);
  });
  assert.deepEqual(offenders, [], 'these still render Tailwind emerald, not Telesom green');
});

// ── The emblem is one drawing in four encodings ────────────────────────────

type Geometry = { rings: string[]; disc: string };

const GEOMETRY_PATTERNS: { file: string; rings: RegExp; disc: RegExp }[] = [
  {
    file: '../public/brand/telesom-emblem.svg',
    rings: /cx="(\d+)" cy="(\d+)" rx="(\d+)" ry="(\d+)"[^>]*rotate\(-28\.7 (\d+) (\d+)\)/g,
    disc: /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/,
  },
  {
    file: '../public/favicon.svg',
    rings: /cx="(\d+)" cy="(\d+)" rx="(\d+)" ry="(\d+)"[^>]*rotate\(-28\.7 (\d+) (\d+)\)/g,
    disc: /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/,
  },
  {
    file: '../src/components/brand/TelesomLogo.tsx',
    rings: /cx="(\d+)"\s+cy="(\d+)"\s+rx="(\d+)"\s+ry="(\d+)"\s+transform="rotate\(-28\.7 (\d+) (\d+)\)"/g,
    disc: /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/,
  },
  {
    file: '../scripts/generate-icons.mjs',
    rings: /onRing\(ex, ey, (\d+), (\d+), (\d+), (\d+), [\d.]+\)/g,
    disc: /Math\.hypot\(ex - (\d+), ey - (\d+)\) <= (\d+)/,
  },
];

test('all four copies of the emblem agree on the orbits', () => {
  const found = GEOMETRY_PATTERNS.map(({ file, rings }) => {
    const matches = [...read(file).matchAll(rings)].map((m) => m.slice(1, 5).join(','));
    assert.ok(matches.length >= 2, `${file} should contain both orbit rings, found ${matches.length}`);
    return { file: file.split('/').pop(), rings: matches.sort() };
  });

  const reference = found[0];
  for (const copy of found.slice(1)) {
    assert.deepEqual(copy.rings, reference.rings, `${copy.file} has drifted from ${reference.file}`);
  }
});

test('all four copies of the emblem agree on the disc', () => {
  const discs = GEOMETRY_PATTERNS.map(({ file, disc }) => {
    const match = disc.exec(read(file));
    assert.ok(match, `${file} has no disc`);
    return { file: file.split('/').pop(), at: match.slice(1).join(',') };
  });

  // The generator omits the radius (it compares a distance to it inline), so
  // compare only what each copy actually states.
  const positions = discs.map((d) => d.at.split(',').slice(0, 2).join(','));
  assert.equal(new Set(positions).size, 1, `disc position differs: ${JSON.stringify(discs)}`);
});
