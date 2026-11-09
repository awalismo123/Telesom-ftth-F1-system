import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  COUNT_WORDS,
  countLabel,
  daysFromToday,
  formatDate,
  formatDateLong,
  formatDateWithWeekday,
  formatDateTime,
  formatDbm,
  formatDuration,
  formatNumber,
  formatTime,
  pluralise,
  todayKey,
} from '../src/lib/format';

/**
 * Batch F — the language contract.
 *
 * The app has one typed dictionary for shared vocabulary and inline
 * `so ? … : …` pairs for screen-specific copy. Both are fine; what is not fine
 * is a string that only ever appears in one language, because that is what a
 * Somali-speaking technician sees as English.
 *
 * The rules below are enforced over the real sources. Where a literal is
 * deliberately not translated (a brand name, a phone number example), it goes in
 * `COPY_ALLOWLIST` with a reason — an explicit list, not a clever heuristic.
 */

const root = fileURLToPath(new URL('../src', import.meta.url));

const sourceFiles: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
})(root);

const read = (path: string) => readFileSync(join(root, path), 'utf8');

/* -------------------------------------------------------------------------- */
/* The dictionary                                                              */
/* -------------------------------------------------------------------------- */

const i18n = read('lib/i18n.tsx');
const enBlock = i18n.slice(i18n.indexOf('  en: {'), i18n.indexOf('  so: {'));
const soBlock = i18n.slice(i18n.indexOf('  so: {'));

const entries = (block: string) => {
  const map = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = /^    ([a-zA-Z0-9_]+): (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/.exec(line);
    if (match) map.set(match[1], match[2] ?? match[3] ?? '');
  }
  return map;
};

const en = entries(enBlock);
const so = entries(soBlock);

test('every key exists in both languages', () => {
  const missingSo = [...en.keys()].filter((key) => !so.has(key));
  const missingEn = [...so.keys()].filter((key) => !en.has(key));

  assert.deepEqual(missingSo, [], 'keys missing from Somali');
  assert.deepEqual(missingEn, [], 'keys missing from English');
  assert.ok(en.size > 100, 'the dictionary should still be substantial');
});

test('placeholder names match between languages', () => {
  const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const [key, english] of en) {
    assert.deepEqual(
      names(english),
      names(so.get(key) ?? ''),
      `"${key}" interpolates different names in each language`,
    );
  }
});

test('no key is dead weight', () => {
  // A key counts as used if its name appears anywhere in the source outside the
  // dictionary — this catches `t(REASON_KEY[row.reason])`, where the key is
  // written in a lookup table rather than in a `t('…')` call. (An earlier
  // static-`t('key')`-only audit wrongly called three live keys unused.)
  const elsewhere = sourceFiles
    .filter((file) => !file.endsWith('lib/i18n.tsx'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const unused = [...en.keys()].filter((key) => !new RegExp(`\\b${key}\\b`).test(elsewhere));
  assert.deepEqual(unused, [], 'delete these keys, or use them');
});

test('no duplicate keys inside a language block', () => {
  for (const [name, block] of [
    ['English', enBlock],
    ['Somali', soBlock],
  ] as const) {
    const seen = new Set<string>();
    for (const line of block.split('\n')) {
      const key = /^    ([a-zA-Z0-9_]+):/.exec(line)?.[1];
      if (!key) continue;
      assert.ok(!seen.has(key), `${name} defines "${key}" twice`);
      seen.add(key);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* No English-only copy                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Literals that are intentionally not translated. Each needs a reason, so the
 * next person knows whether they can add to it.
 */
const COPY_ALLOWLIST = new Set([
  // Brand and product identity — the same in both languages.
  'TELESOM FBB',
  'Telesom FTTH',
  'Group F1 Operations',
  'FTTH • GROUP F1',
  'Fixed Broadband · Group F1',
  'Group F1',
  // Sheet categories posted in the group chat, written this way on the sheets.
  'Galinta',
  'Cilada',
  // Example values in placeholders: a box code and a vehicle tag are data, and
  // the same in both languages.
  'FAT 48',
  'F1 - Crew A',
  'Gaadhi 01',
  // Crash-card labels are paired with a bilingual sentence inside the card.
  'Telesom FTTH',
  'Header',
  'Supervisor',
  'My route',
]);

/** Attributes that carry copy a person reads or a screen reader speaks. */
const COPY_ATTR = /\b(placeholder|alt|label|hint|description|heading|aria-description)\s*=\s*"([^"]{3,})"/g;
/** Title and aria-label are frequently set from variables; only literals count. */
const ARIA_ATTR = /\b(title|aria-label)\s*=\s*"([^"]{3,})"/g;

/**
 * JSX text, scanned over the *whole file* rather than line by line: a sentence
 * wrapped across two lines is still one sentence, and the first version of this
 * lint missed a visible English footer for exactly that reason.
 */
const JSX_TEXT = />\s*([^<>{}]+?)\s*</g;

/**
 * What a piece of visible copy looks like. Deliberately narrow — letters,
 * digits, spaces and the punctuation we actually use in sentences — so that
 * `groupId ? readCache(...)` between two tags is not mistaken for copy.
 */
const COPY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 .,·•—–'’!%+\-]{3,119}$/;

/**
 * Files that show both languages at once on purpose, so neither line is
 * "copy in only one language". One entry, with a reason; not a general escape.
 */
const BILINGUAL_BY_DESIGN = new Set([
  // The crash card is read by whoever is looking at the screen, in whichever
  // language they read, so it always prints the sentence twice.
  'components/ui/ErrorBoundary.tsx',
]);

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function englishOnlyLiterals(file: string): string[] {
  const raw = read(file);
  const source = stripComments(raw);
  const found: string[] = [];

  // Line lookup by offset, so a match can be judged against its own line.
  const starts = [0];
  for (let i = 0; i < raw.length; i += 1) if (raw[i] === '\n') starts.push(i + 1);
  const lineAt = (index: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    const end = raw.indexOf('\n', starts[low]);
    return raw.slice(starts[low], end === -1 ? raw.length : end);
  };

  const consider = (value: string, index: number) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || COPY_ALLOWLIST.has(text)) return;
    // A line that offers both languages is, by definition, translated.
    if (/\bso\s*\?|lang === 'so'|lang === "so"|i18n\b/.test(lineAt(index))) return;
    if (!COPY_SHAPE.test(text)) return;
    // Needs at least two real words to be a sentence rather than a token.
    if (!/[A-Za-z]{2,}[\s,·•—–]/.test(text)) return;
    found.push(`${file}: ${text}`);
  };

  for (const pattern of [COPY_ATTR, ARIA_ATTR]) {
    for (const match of source.matchAll(pattern)) consider(match[2] ?? '', match.index ?? 0);
  }
  for (const match of source.matchAll(JSX_TEXT)) consider(match[1] ?? '', match.index ?? 0);

  return [...new Set(found)];
}

test('no screen ships copy in only one language', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles) {
    const relative = file.slice(root.length + 1);
    if (relative === 'lib/i18n.tsx') continue;
    if (BILINGUAL_BY_DESIGN.has(relative)) continue;
    offenders.push(...englishOnlyLiterals(relative));
  }

  assert.deepEqual(
    offenders,
    [],
    'translate these, or add them to COPY_ALLOWLIST with a reason:\n' + offenders.join('\n'),
  );
});

/* -------------------------------------------------------------------------- */
/* Dates, numbers, plurals                                                     */
/* -------------------------------------------------------------------------- */

test('dates are day/month/year, and a date-only value never shifts a day', () => {
  assert.equal(formatDate('2026-10-31'), '31/10/2026');
  assert.equal(formatDate('2026-01-05'), '05/01/2026');
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('not a date'), '—');

  // Parsed as a local calendar date, not UTC midnight.
  assert.equal(formatDate('2026-12-31'), '31/12/2026');
});

test('long dates use the Somali month names when the language is Somali', () => {
  assert.equal(formatDateLong('2026-10-31', 'so'), '31 Oktoobar 2026');
  assert.equal(formatDateLong('2026-10-31', 'en'), '31 Oct 2026');
  assert.equal(formatDateLong('2026-01-02', 'so'), '2 Jannaayo 2026');
});

test('timestamps keep the clock with the day', () => {
  const stamp = '2026-10-31T14:05:00';
  assert.equal(formatTime(stamp), '14:05');
  assert.equal(formatDateTime(stamp, 'en'), '31 Oct 2026 · 14:05');
  assert.match(formatDateWithWeekday('2026-10-31', 'so'), /^Sabti 31\/10\/2026$/);
});

test('today is the local day, not the UTC day', () => {
  // 22:30 local on the 31st is already the 1st in UTC; the app must file the
  // job under the local date a supervisor would call "today".
  const lateEvening = new Date(2026, 9, 31, 22, 30, 0);
  assert.equal(todayKey(lateEvening), '2026-10-31');
});

test('day differences are whole calendar days', () => {
  const now = new Date(2026, 9, 31, 9, 0, 0);
  assert.equal(daysFromToday('2026-10-31', now), 0);
  assert.equal(daysFromToday('2026-11-02', now), 2);
  assert.equal(daysFromToday('2026-10-29', now), -2);
});

test('numbers group thousands and keep the decimals asked for', () => {
  assert.equal(formatNumber(1234), '1,234');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(1234.5, 1), '1,234.5');
  assert.equal(formatNumber(-1234.5, 2), '-1,234.50');
  assert.equal(formatNumber(null), '—');
  assert.equal(formatNumber(Number.NaN), '—');
});

test('optical readings always carry the unit and one decimal', () => {
  assert.equal(formatDbm(-18.75), '-18.8 dBm');
  assert.equal(formatDbm('21.5'), '21.5 dBm');
  assert.equal(formatDbm(null), '—');
});

test('durations read as time spent, not time of day', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(600), '10m');
  assert.equal(formatDuration(3900), '1h 05m');
  assert.equal(formatDuration(null), '—');
});

test('plural forms differ per language, and Somali uses the singular after a numeral', () => {
  assert.equal(pluralise(1, COUNT_WORDS.jobs.en, 'en'), '1 job');
  assert.equal(pluralise(4, COUNT_WORDS.jobs.en, 'en'), '4 jobs');
  assert.equal(pluralise(1, COUNT_WORDS.jobs.so, 'so'), '1 shaqo');
  // "laba shaqo", never "laba shaqooyin" — Somali takes the singular here.
  assert.equal(pluralise(4, COUNT_WORDS.jobs.so, 'so'), '4 shaqo');

  assert.equal(countLabel(2, 'routes', 'en'), '2 routes');
  assert.equal(countLabel(2, 'routes', 'so'), '2 jid');
  assert.equal(countLabel(1, 'customers', 'en'), '1 customer');
});

test('every count word is complete in both languages', () => {
  for (const [word, forms] of Object.entries(COUNT_WORDS)) {
    for (const lang of ['en', 'so'] as const) {
      assert.ok(forms[lang].one.length > 0, `${word}.${lang}.one`);
      assert.ok(forms[lang].other.length > 0, `${word}.${lang}.other`);
    }
  }
});
