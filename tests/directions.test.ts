import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_COPY,
  geoSearchUri,
  mapQuery,
  mapSearchUrl,
  spokenLocation,
} from '../src/lib/directions';

const componentsDir = fileURLToPath(new URL('../src/components/', import.meta.url));

/** Blank out comments so a scan cannot match the prose that explains the rule. */
function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/**
 * The one thing these tests exist to prevent: the app pretending it knows where
 * a cable box is. There are no coordinates in this system, and a pin on the city
 * centre would send a technician to the wrong street while looking authoritative.
 */

/* -------------------------------------------------------------------------- */
/* The query is built from real fields only                                    */
/* -------------------------------------------------------------------------- */

test('the box code leads the search, because it is printed on the cabinet', () => {
  assert.equal(mapQuery({ boxCode: 'FAT48' }), 'FAT48');
  assert.equal(mapQuery({ boxCode: 'B6 (52)' }), 'B6 (52)');
});

test('the neighbourhood is added, because a box code is only unique in the group', () => {
  // "FAT48" alone could be anywhere in Hargeisa. With the area it is a street.
  assert.equal(mapQuery({ boxCode: 'FAT48', xaafada: 'JIGJIGAYAR' }), 'FAT48, JIGJIGAYAR');
});

test('the neighbourhood alone is a usable search', () => {
  assert.equal(mapQuery({ xaafada: 'Gantalaha' }), 'Gantalaha');
});

test('location notes never reach a map search', () => {
  // These are written for colleagues, not for a geocoder:
  // "Port 7 connector clip loose — use Ports 1–6 or 8" would produce noise.
  const query = mapQuery({
    boxCode: 'FAT48',
    xaafada: 'JIGJIGAYAR',
    locationNotes: 'Port 7 connector clip loose — use Ports 1–6 or 8',
  });
  assert.doesNotMatch(query, /Port 7/);
  assert.doesNotMatch(query, /connector/);
  assert.equal(query, 'FAT48, JIGJIGAYAR');
});

test('whitespace-only fields are not a place', () => {
  assert.equal(mapQuery({ boxCode: '   ', xaafada: '  ' }), '');
  assert.equal(mapQuery({}), '');
  assert.equal(mapQuery({ boxCode: null, xaafada: null }), '');
});

test('a place with only whitespace beside a real field still works', () => {
  assert.equal(mapQuery({ boxCode: '  FAT48  ', xaafada: '   ' }), 'FAT48');
});

/* -------------------------------------------------------------------------- */
/* It is a SEARCH, never a coordinate                                          */
/* -------------------------------------------------------------------------- */

test('the Google link is a search URL with no coordinates', () => {
  const url = mapSearchUrl({ boxCode: 'FAT48', xaafada: 'JIGJIGAYAR' })!;

  assert.match(url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  // A coordinate pin would look like `?q=9.56,44.06` or `/maps/search/9.56,44.06`.
  assert.doesNotMatch(url, /-?\d+\.\d+\s*,\s*-?\d+\.\d+/, 'the URL contains a coordinate pair');
  assert.doesNotMatch(url, /\/@-?\d/, 'the URL contains a map viewport');
  assert.doesNotMatch(url, /dirflg|saddr|daddr/, 'the URL requests turn-by-turn directions');
});

test('the OpenStreetMap link is a search URL too', () => {
  const url = mapSearchUrl({ boxCode: 'FAT48' }, 'osm')!;
  assert.match(url, /^https:\/\/www\.openstreetmap\.org\/search\?query=/);
  assert.doesNotMatch(url, /#map=/);
  assert.doesNotMatch(url, /mlat|mlon/);
});

test('the geo: URI searches rather than navigating to a zero coordinate', () => {
  // `geo:0,0?q=` is the documented "search" form. `geo:0,0` alone would ask the
  // map app to navigate to latitude 0, longitude 0 — the Gulf of Guinea.
  const uri = geoSearchUri({ boxCode: 'FAT48' })!;
  assert.match(uri, /^geo:0,0\?q=/);
  assert.doesNotMatch(uri, /^geo:-?\d+\.\d+,-?\d+\.\d+/, 'a real coordinate pair was invented');
});

test('no link is produced when there is nothing to search for', () => {
  // A button that opens a map searching for "" is a dead end dressed as action.
  assert.equal(mapSearchUrl({}), null);
  assert.equal(mapSearchUrl({ boxCode: '  ' }), null);
  assert.equal(geoSearchUri({}), null);
});

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

test('the query survives encoding and decodes back exactly', () => {
  const place = { boxCode: 'B6 (52)', xaafada: 'Gantalaha' };
  const url = mapSearchUrl(place)!;
  const encoded = url.slice(url.indexOf('query=') + 'query='.length);
  assert.equal(decodeURIComponent(encoded), 'B6 (52), Gantalaha');
});

test('a box code with characters that break a query string still works', () => {
  // Box codes come from an OCR'd sheet. `&` in a query string truncates it.
  const place = { boxCode: 'B6 & B7', xaafada: 'Gantalaha' };
  const url = mapSearchUrl(place)!;
  const encoded = url.slice(url.indexOf('query=') + 'query='.length);
  assert.equal(decodeURIComponent(encoded), 'B6 & B7, Gantalaha');
  assert.equal(encoded.includes('&'), false, 'an unescaped ampersand would truncate the search');
});

/* -------------------------------------------------------------------------- */
/* What a person is told                                                       */
/* -------------------------------------------------------------------------- */

test('the label says it is a search, not a saved pin', () => {
  // The honesty of the feature lives in this sentence. Without it a technician
  // reasonably assumes the app knows where the box is.
  assert.match(MAP_COPY.note.en, /not a saved pin/i);
  assert.match(MAP_COPY.note.so, /ma aha goob la keydiyay/i);
  assert.match(MAP_COPY.note.en, /map search/i);
});

test('every piece of copy is translated and non-trivial', () => {
  for (const [key, copy] of Object.entries(MAP_COPY)) {
    assert.ok(copy.en.length > 5, `${key} has no English copy`);
    assert.ok(copy.so.length > 5, `${key} has no Somali copy`);
    assert.notEqual(copy.en, copy.so, `${key} is not translated`);
  }
});

test('the spoken location includes the details a map search leaves out', () => {
  // "Second gate on the left" is what gets someone to the right cabinet. It is
  // useless to a geocoder and essential to a person.
  const parts = spokenLocation({
    boxCode: 'FAT48',
    xaafada: 'JIGJIGAYAR',
    locationNotes: 'Second gate on the left after the mosque',
  });

  assert.deepEqual(parts, ['FAT48', 'JIGJIGAYAR', 'Second gate on the left after the mosque']);
});

test('a spoken location skips fields that are missing', () => {
  assert.deepEqual(spokenLocation({ boxCode: 'FAT48' }), ['FAT48']);
  assert.deepEqual(spokenLocation({ xaafada: 'Gantalaha', locationNotes: '  ' }), ['Gantalaha']);
  assert.deepEqual(spokenLocation({}), []);
});

/* -------------------------------------------------------------------------- */
/* Free, and unable to become paid                                             */
/* -------------------------------------------------------------------------- */

test('the links need no key, no account and no SDK', () => {
  // Cost discipline: opening a maps URL in a browser is free and unlimited on
  // both providers. An embedded map would introduce a tile quota; an API key
  // would introduce a bill. Neither is present.
  const google = mapSearchUrl({ boxCode: 'FAT48' })!;
  const osm = mapSearchUrl({ boxCode: 'FAT48' }, 'osm')!;

  for (const url of [google, osm]) {
    assert.doesNotMatch(url, /key=|api_key|token=|access_token/i, 'the URL carries a credential');
  }
});

/* -------------------------------------------------------------------------- */
/* A link may never live inside a button                                       */
/* -------------------------------------------------------------------------- */

test('no anchor is nested inside a button anywhere in the app', () => {
  // I put the map link inside the route card's outer <button> on the first
  // attempt. An <a> inside a <button> is invalid HTML, and a tap would both
  // open the map and open the job sheet — a bug a type check cannot see and a
  // browser silently tolerates.
  //
  // The scan strips comments first: the first version of it reported a false
  // positive against the JSX comment that *explains* the rule.
  const files = readdirSync(componentsDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((name) => name.endsWith('.tsx'));

  const violations: string[] = [];

  for (const name of files) {
    const path = join(componentsDir, name);
    const source = stripComments(readFileSync(path, 'utf8'));
    let depth = 0;

    for (const match of source.matchAll(/<button\b[^>]*?\/?>|<\/button>|<a\b|<Link\b/gs)) {
      const token = match[0];
      const line = source.slice(0, match.index).split('\n').length;

      if (token.startsWith('<button') && !token.trimEnd().endsWith('/>')) {
        depth += 1;
      } else if (token === '</button>') {
        depth = Math.max(0, depth - 1);
      } else if (depth > 0 && (token.startsWith('<a') || token.startsWith('<Link'))) {
        violations.push(`${name}:${line} — ${token} inside <button>`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    'a link inside a button opens two things at once and is invalid HTML',
  );
});
