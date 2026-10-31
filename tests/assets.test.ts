import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Install assets are easy to break silently: a manifest that points at a file
 * nobody generated, an icon with the wrong dimensions, a theme colour that no
 * longer matches the app. These checks run in `npm test`, so a broken install
 * fails the same gate as broken code.
 */

const root = new URL('../', import.meta.url);
const file = (path: string) => fileURLToPath(new URL(path, root));

test('the web app manifest is valid and every icon exists', () => {
  const manifestPath = file('public/manifest.webmanifest');
  assert.ok(existsSync(manifestPath), 'manifest.webmanifest must be committed');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.short_name, 'string');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

  for (const icon of manifest.icons) {
    const path = file(`public${icon.src}`);
    assert.ok(existsSync(path), `${icon.src} is referenced by the manifest but missing`);
    assert.ok(statSync(path).size > 1000, `${icon.src} looks empty`);
  }

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(
    manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable'),
    'Android needs a maskable icon',
  );
});

test('the PNG icons really are PNGs of the size they claim', () => {
  for (const [name, size] of [
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/apple-touch-icon.png', 180],
  ] as const) {
    const buffer = readFileSync(file(name));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${name} is not a PNG`);
    assert.equal(buffer.readUInt32BE(16), size, `${name} width`);
    assert.equal(buffer.readUInt32BE(20), size, `${name} height`);
  }
});

test('index.html links the manifest, the touch icon and the theme colour', () => {
  const html = readFileSync(file('index.html'), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-touch-icon\.png/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /viewport-fit=cover/);
});
