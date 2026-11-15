import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyTextSize,
  isTextSize,
  nextTextSize,
  readTextSize,
  textSizeCopy,
  writeTextSize,
  TEXT_SIZE_ORDER,
} from '../src/lib/textSize';

/**
 * Larger-text mode.
 *
 * The setting itself is trivial; the failure modes are not. A preference that
 * throws in private mode, a cycle that gets stuck, or — the expensive one — a
 * new px-locked label that nobody adds to the CSS, so it stays tiny in the mode
 * built for people who cannot read tiny text.
 */

const storageWith = (value: string | null) => ({
  getItem: () => value,
  setItem: () => undefined,
});

test('an unreadable or missing preference falls back to normal', () => {
  assert.equal(readTextSize(storageWith(null)), 'normal');
  assert.equal(readTextSize(storageWith('enormous')), 'normal');
  assert.equal(readTextSize(storageWith('')), 'normal');
});

test('storage that throws does not stop the app rendering', () => {
  // Private browsing, a blocked cookie jar, a quota error.
  const hostile = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(readTextSize(hostile), 'normal');
  assert.doesNotThrow(() => writeTextSize('large', hostile));
});

test('the cycle visits every size and comes back', () => {
  let size = TEXT_SIZE_ORDER[0];
  const seen = [size];
  for (let i = 0; i < TEXT_SIZE_ORDER.length - 1; i += 1) {
    size = nextTextSize(size);
    seen.push(size);
  }
  assert.deepEqual(seen, [...TEXT_SIZE_ORDER]);
  assert.equal(nextTextSize(size), TEXT_SIZE_ORDER[0], 'the cycle must wrap');
});

test('applying sets the attribute the CSS keys on', () => {
  const attrs: Record<string, string> = {};
  applyTextSize('xlarge', { setAttribute: (n, v) => void (attrs[n] = v) });
  assert.equal(attrs['data-text-size'], 'xlarge');
});

test('the copy names the current size and the one after it', () => {
  const en = textSizeCopy('large', 'en');
  assert.equal(en.short, 'Large');
  assert.match(en.label, /Large/);
  assert.match(en.next, /Extra large/);
});

test('Somali copy is not the English copy', () => {
  for (const size of TEXT_SIZE_ORDER) {
    const en = textSizeCopy(size, 'en');
    const so = textSizeCopy(size, 'so');
    assert.notEqual(en.label, so.label, `${size} label is identical in both languages`);
    assert.notEqual(en.short, so.short, `${size} short name is identical in both languages`);
  }
});

test('isTextSize rejects everything that is not a size', () => {
  for (const value of ['', 'Normal', 'LARGE', null, undefined, 0, {}]) {
    assert.equal(isTextSize(value), false, `${String(value)} should be rejected`);
  }
  for (const value of TEXT_SIZE_ORDER) assert.equal(isTextSize(value), true);
});

// ── The CSS must cover every px-locked size the app actually uses ──────────

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}

test('every px-locked text size is lifted in larger-text mode', () => {
  // This is the one that will actually break: someone adds `text-[9px]` or a
  // `text-[14px]`, the root scale grows around it, and the smallest label on
  // the screen — the reason the setting exists — stays exactly as small.
  const used = new Set<string>();
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/text-\[(\d+)px\]/g)) used.add(match[1]);
  }
  assert.ok(used.size > 0, 'expected px-locked text sizes in the source');

  const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
  const missing: string[] = [];
  for (const size of used) {
    for (const mode of ['large', 'xlarge']) {
      const rule = new RegExp(
        `html\\[data-text-size='${mode}'\\]\\s*\\[class\\*='text-\\[${size}px\\]'\\]`,
      );
      if (!rule.test(css)) missing.push(`${mode}: text-[${size}px]`);
    }
  }
  assert.deepEqual(missing, [], 'add these to the larger-text block in index.css');
});

test('the two modes actually differ, and both are bigger than normal', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
  const rootSize = (mode: string) => {
    const match = new RegExp(`html\\[data-text-size='${mode}'\\]\\s*\\{\\s*font-size:\\s*(\\d+)px`).exec(css);
    return Number(match?.[1] ?? 0);
  };
  assert.ok(rootSize('large') > 16, 'large must be bigger than the 16px default');
  assert.ok(rootSize('xlarge') > rootSize('large'), 'xlarge must be bigger than large');
});

test('larger text does not shrink a touch target', () => {
  // Growing type while leaving buttons at 44px would trade one access problem
  // for another; the CSS keeps a floor under every button in both modes.
  const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
  assert.match(css, /data-text-size='xlarge'\]\s*button\s*\{\s*min-height:\s*2\.75rem/);
});
