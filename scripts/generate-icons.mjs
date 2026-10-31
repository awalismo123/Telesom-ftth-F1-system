/**
 * Generate the app icon set — a small, dependency-free PNG writer.
 *
 * The mark is the one already used in the UI: a Wi-Fi glyph on the emerald
 * gradient. Rendered with 4×4 supersampling so the arcs stay smooth at 180 px
 * on a phone home screen.
 *
 *   node scripts/generate-icons.mjs
 *
 * Output (committed, so a build never depends on this script):
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 *   public/icons/icon-maskable-512.png
 *   public/apple-touch-icon.png
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = new URL('../public/icons/', import.meta.url);
const APPLE = new URL('../public/apple-touch-icon.png', import.meta.url);

const CRCPOLY = 0xedb88320;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? CRCPOLY ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Distance from a point to the rounded-rectangle boundary (negative inside). */
function roundedRectDistance(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius;
}

function render(size, { rounded = true, glyphScale = 1 } = {}) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.225 : 0;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;

          const dist = roundedRectDistance(x, y, size, radius);
          const bgAlpha = rounded ? clamp01(0.5 - dist) : 1;
          if (bgAlpha <= 0) continue;

          // Emerald gradient, top-left light → bottom-right deep.
          const t = clamp01((x / size) * 0.6 + (y / size) * 0.4);
          let cr = lerp(16, 4, t);
          let cg = lerp(185, 120, t);
          let cb = lerp(129, 87, t);

          // Wi-Fi glyph: three arcs + dot, opening upwards.
          const cx = size * 0.5;
          const cy = size * 0.66;
          const dx = (x - cx) / (size * glyphScale);
          const dy = (y - cy) / (size * glyphScale);
          const d = Math.hypot(dx, dy);
          const angle = Math.abs(Math.atan2(dx, -dy)); // 0 = straight up
          const stroke = 0.052;

          const onArc = (radius) =>
            angle <= 0.95 && Math.abs(d - radius) <= stroke / 2;
          const glyph =
            d <= 0.058 || onArc(0.125) || onArc(0.225) || onArc(0.325);

          if (glyph) {
            const gx = clamp01((0.5 - Math.abs(d - 0.2)) * 12);
            cr = lerp(cr, 255, 1);
            cg = lerp(cg, 255, 1);
            cb = lerp(cb, 255, 1);
            void gx;
          }

          r += cr;
          g += cg;
          b += cb;
          a += bgAlpha;
        }
      }

      const samples = SS * SS;
      const coverage = a / samples;
      const index = (py * size + px) * 4;
      if (coverage <= 0) {
        out[index + 3] = 0;
        continue;
      }
      // Average only the covered subpixels for colour.
      out[index] = Math.round(r / Math.max(a, 1e-6));
      out[index + 1] = Math.round(g / Math.max(a, 1e-6));
      out[index + 2] = Math.round(b / Math.max(a, 1e-6));
      out[index + 3] = Math.round(coverage * 255);
    }
  }

  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { path: new URL('icon-192.png', OUT_DIR), size: 192, options: {} },
  { path: new URL('icon-512.png', OUT_DIR), size: 512, options: {} },
  { path: new URL('icon-maskable-512.png', OUT_DIR), size: 512, options: { rounded: false, glyphScale: 1.28 } },
  { path: APPLE, size: 180, options: { rounded: false, glyphScale: 1.18 } },
];

for (const target of targets) {
  const pixels = render(target.size, target.options);
  writeFileSync(target.path, encodePng(target.size, target.size, pixels));
  console.log(`[icons] ${target.path.pathname.split('/').slice(-2).join('/')} — ${target.size}px`);
}
