/**
 * Generate the app icon set — a small, dependency-free PNG writer.
 *
 * The mark is the Telesom emblem — the same measured geometry as
 * `public/brand/telesom-emblem.svg` and `TelesomEmblem.tsx`, redrawn with
 * point-in-shape tests so this script stays dependency-free. Rendered with 4×4
 * supersampling so the thin orbit rings survive at 180 px.
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

/**
 * The Telesom emblem, in its own coordinate space (the viewBox of
 * `public/brand/telesom-emblem.svg`, which these shapes mirror exactly).
 *
 * Drawing it here rather than rasterising the SVG keeps this script
 * dependency-free, and means the icon set and the in-app logo cannot drift:
 * both are generated from the same measured geometry.
 */
const EMBLEM = { x0: 110, y0: 82, w: 270, h: 178, rot: (-28.7 * Math.PI) / 180 };
const BLUE = [0x31, 0x31, 0x95];
const GOLD = [0xf8, 0xdc, 0x09];
const WHITE = [0xff, 0xff, 0xff];

/** Is (x,y) inside the rotated elliptical ring centred (cx,cy)? */
function onRing(x, y, cx, cy, rx, ry, stroke) {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-EMBLEM.rot);
  const s = Math.sin(-EMBLEM.rot);
  const u = dx * c - dy * s;
  const v = dx * s + dy * c;
  const k = Math.hypot(u / rx, v / ry);
  // Approximate distance to the ellipse, in emblem units.
  return Math.abs(k - 1) * Math.min(rx, ry) <= stroke / 2;
}

/** Point-in-triangle, sign-of-cross-product form. */
function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Colour of the emblem at a point, or null for background. */
function emblemAt(ex, ey) {
  // Back to front, exactly as the SVG paints them.
  if (onRing(ex, ey, 237, 178, 112, 56, 11.5)) return GOLD;
  if (inTriangle(ex, ey, [300, 203], [350, 258], [220, 258])) return GOLD;
  if (inTriangle(ex, ey, [250, 100], [177, 258], [302, 258])) return BLUE;
  if (onRing(ex, ey, 230, 172, 116, 61, 11.5)) return BLUE;
  if (Math.hypot(ex - 217, ey - 181) <= 45) return GOLD;
  return null;
}

function render(size, { rounded = true, glyphScale = 1 } = {}) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.225 : 0;
  const pad = 0.14;
  const scale = ((size * (1 - pad * 2)) / EMBLEM.w) * glyphScale;
  const originX = (size - EMBLEM.w * scale) / 2;
  const originY = (size - EMBLEM.h * scale) / 2;

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

          // The mark was drawn for white paper, so the icon is white paper.
          let cr = WHITE[0];
          let cg = WHITE[1];
          let cb = WHITE[2];

          const ex = (x - originX) / scale + EMBLEM.x0;
          const ey = (y - originY) / scale + EMBLEM.y0;
          const hit = emblemAt(ex, ey);
          if (hit) {
            cr = hit[0];
            cg = hit[1];
            cb = hit[2];
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
  { path: new URL('icon-maskable-512.png', OUT_DIR), size: 512, options: { rounded: false, glyphScale: 0.86 } },
  { path: APPLE, size: 180, options: { rounded: false, glyphScale: 0.94 } },
];

for (const target of targets) {
  const pixels = render(target.size, target.options);
  writeFileSync(target.path, encodePng(target.size, target.size, pixels));
  console.log(`[icons] ${target.path.pathname.split('/').slice(-2).join('/')} — ${target.size}px`);
}
