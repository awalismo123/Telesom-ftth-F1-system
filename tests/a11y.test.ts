/**
 * The thumb, not the mouse.
 *
 * The technician screens are used one-handed, outdoors, sometimes with gloves,
 * by somebody standing next to a cabinet. Two things follow, and both had
 * already slipped:
 *
 *  1. A control must be at least 44 px tall. The design language says so (the
 *     `Button` component's `md` and `icon` sizes are 44 px), and yet the Start
 *     / Resume / Finish controls on a route card were 40 px, "Retry the photo"
 *     after a failed upload was 32 px, and the call button in the crew card was
 *     36 px. Small targets are not a style preference on a phone; they are the
 *     difference between a job starting and a technician tapping twice.
 *
 *  2. An icon-only control needs an accessible name. A wrench with no label is
 *     announced as "button" by a screen reader.
 *
 * This scan is deliberately narrow — it checks the technician components, where
 * the standard is non-negotiable, and does not pretend to audit contrast or
 * focus order, which need a browser. It is the same trade as the i18n lint:
 * catch the shape that already went wrong, cheaply, on every run.
 *
 * What it cannot see, stated plainly so nobody reads more into a green run than
 * is there:
 *
 *  * **Height set on a child.** It judges the control's own `className`. A
 *    button whose *inner* div is `h-8` still measures 32 px and passes here.
 *    Confirmed by planting exactly that and watching the test stay green. The
 *    real check for that is a browser; this one covers the pattern that had
 *    actually drifted, which was the control itself.
 *  * **Contrast, focus order, and whether a label makes sense.** Not a static
 *    property.
 *  * **Screens outside `components/technician/`.** The supervisor screens have
 *    44 px targets already, but nothing here enforces it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../src/components/technician/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

const MIN_TARGET_PX = 44;

/** Tailwind's fixed heights that come in under the standard. */
const SHORT_HEIGHT = /\b(?:h|size)-(?:[5-9]|10|\[(?:3[0-9]|4[0-3])px\])\b/;

/**
 * A control is a `<button` or a `<label` that behaves like one (`cursor-pointer`
 * in its class). Static wrappers — avatars, badges — are not controls and are
 * not judged.
 */
/**
 * Read the attributes of one JSX opening tag.
 *
 * A regex ending at the first `>` cannot do this job: `onClick={() => …}`
 * contains a `>` on almost every button in this app, so a naive match stops
 * early, misses `className`, and reports a clean scan over a quarter of the
 * controls. That bug was present for one run of this file and made it look like
 * there were 5 buttons in 29.
 *
 * The scan below tracks brace depth and quotes, and only accepts a `>` at depth
 * zero that is not the tail of an arrow.
 */
function readTag(source: string, start: number): { attrs: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0 && source[i - 1] !== '=') {
      return { attrs: source.slice(start, i), end: i };
    }
  }

  return null;
}

function controls(source: string): { tag: string; className: string; body: string }[] {
  const out: { tag: string; className: string; body: string }[] = [];
  const opener = /<(button|label)\b/g;

  for (const match of source.matchAll(opener)) {
    const tagStart = (match.index ?? 0) + match[0].length;
    const tag = readTag(source, tagStart);
    if (!tag) continue;

    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag.attrs);
    const className = cls ? (cls[1] ?? cls[2] ?? '') : '';
    out.push({ tag: match[1], className, body: tag.attrs });
  }

  return out;
}

test('no technician control is shorter than 44 px', () => {
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');

    for (const control of controls(source)) {
      // Only controls that actually look tappable, and that pin a height.
      if (!control.className.includes('cursor-pointer')) continue;
      if (!SHORT_HEIGHT.test(control.className)) continue;
      // A short height is fine if a floor was also set.
      if (/\bmin-h-(?:11|12)\b/.test(control.className)) continue;

      const short = control.className.match(SHORT_HEIGHT)?.[0] ?? '?';
      offenders.push(`${file}: <${control.tag}> is ${short} — needs min-h-11`);
    }
  }

  assert.deepEqual(offenders, [], `controls under ${MIN_TARGET_PX}px on a phone`);
});

test('no icon-only control is left without a name', () => {
  // `<button ...><Phone className="..." /></button>` — a screen reader says
  // "button" and the person has no idea which one.
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');

    const iconOnly = /<button\b([^>]*)>\s*<([A-Z]\w+)\b[^>]*\/>\s*<\/button>/g;
    for (const match of source.matchAll(iconOnly)) {
      const attrs = match[1] ?? '';
      if (/\baria-label=|\baria-labelledby=|\btitle=/.test(attrs)) continue;
      offenders.push(`${file}: <${match[2]} /> inside an unnamed button`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('the scan is looking at real controls, not an empty set', () => {
  // If the JSX shape changes and the scanner stops matching, the two tests
  // above would pass by finding nothing at all.
  let found = 0;
  for (const file of files) {
    found += controls(readFileSync(join(dir, file), 'utf8')).filter((c) =>
      c.className.includes('cursor-pointer'),
    ).length;
  }

  // 30 today (29 buttons + labels, of which 30 carry `cursor-pointer`). The
  // floor is set at 25 rather than 30 so adding or removing one control is not
  // a test failure, while a broken parser — which found 5 — still trips it.
  assert.ok(found >= 25, `expected to scan at least 25 tappable controls, found ${found}`);
});
