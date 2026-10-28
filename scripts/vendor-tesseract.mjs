#!/usr/bin/env node
/**
 * Copies the Tesseract worker, WASM core and English model out of node_modules
 * into public/ so the OCR engine is fully self-hosted (no CDN, works on weak
 * field connections and offline PWAs).
 *
 * Runs automatically before `dev` and `build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const targets = {
  worker: path.join(root, 'public/tesseract'),
  core: path.join(root, 'public/tesseract/core'),
  lang: path.join(root, 'public/tesseract/lang'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copy(from, to) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, to);
  return true;
}

function copyDirFiles(fromDir, toDir, filter) {
  const src = path.join(root, fromDir);
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  for (const file of fs.readdirSync(src)) {
    if (filter && !filter(file)) continue;
    fs.copyFileSync(path.join(src, file), path.join(toDir, file));
    count++;
  }
  return count;
}

Object.values(targets).forEach(ensureDir);

let ok = true;

if (!copy('node_modules/tesseract.js/dist/worker.min.js', path.join(targets.worker, 'worker.min.js'))) {
  console.warn('[vendor-tesseract] worker.min.js not found — run npm install first');
  ok = false;
}

// Engine + core WAST/WASM builds (LSTM and legacy variants, SIMD + plain).
const coreCount = copyDirFiles(
  'node_modules/tesseract.js-core',
  targets.core,
  (f) => f.startsWith('tesseract-core') && (f.endsWith('.wasm.js') || f.endsWith('.wasm')),
);
if (coreCount === 0) {
  console.warn('[vendor-tesseract] tesseract.js-core assets not found');
  ok = false;
}

// English model: "best_int" is 2.9 MB and clearly more accurate on table text
// than the "fast" model, which matters for a mobile upload.
const langCandidates = [
  'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz',
];
let langOk = false;
for (const candidate of langCandidates) {
  if (copy(candidate, path.join(targets.lang, 'eng.traineddata.gz'))) {
    langOk = true;
    break;
  }
}
if (!langOk) {
  console.warn('[vendor-tesseract] eng.traineddata.gz not found');
  ok = false;
}

if (ok) {
  console.log('[vendor-tesseract] assets ready in public/tesseract');
} else {
  process.exitCode = 1;
}
