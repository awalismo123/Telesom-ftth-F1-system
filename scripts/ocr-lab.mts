/**
 * Dev-only harness: runs the exact production OCR pipeline against the real
 * Telesom sample pictures so the extraction can be tuned offline.
 *
 *   npx tsx scripts/ocr-lab.mts samples/cilada-sample.jpeg
 */
import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import jpeg from 'jpeg-js';

import { toGray, otsuThreshold, binarize, detectGrid, resizeRgba, removeRules, maskToRgba } from '../src/lib/ocr/imageOps';
import { assembleTable, type OcrWord } from '../src/lib/ocr/assemble';
import { normalizeRow } from '../src/lib/ocr/normalize';
import type { SheetTemplate } from '../src/lib/ocr/templates';

const file = process.argv[2] ?? 'samples/cilada-sample.jpeg';
const scale = Number(process.argv[3] ?? 2);
const mode = process.argv[4] ?? 'gray'; // gray | binary

const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true });
const base = { data: raw.data, width: raw.width, height: raw.height };
const img = resizeRgba(base, scale);

const gray = toGray(img);
const threshold = otsuThreshold(gray);
const mask = binarize(gray, threshold);
const grid = detectGrid(mask);

console.log(`\n== ${path.basename(file)} @${scale}x (${img.width}x${img.height}) ==`);
console.log(
  `grid: hLines=${grid.horizontalLines.length} vLines=${grid.verticalLines.length} rows=${grid.rowBands.length} cols=${grid.colBands.length} conf=${grid.confidence.toFixed(2)}`,
);
console.log('col centers:', grid.colBands.map((b) => b.center).join(','));
console.log('row centers:', grid.rowBands.map((b) => b.center).join(','));

// Build the image fed to Tesseract: rules erased, pure B/W.
const cleanMask = removeRules(mask, grid, 2);
const cleanRgba = maskToRgba(cleanMask);
const ocrData = cleanRgba.data;

const worker = await createWorker('eng', 1, {
  langPath: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int',
  cacheMethod: 'none',
  logger: () => {},
  errorHandler: (e: unknown) => console.error('worker error', e),
});

// Encode back to a JPEG buffer (Node worker input) — mirrors the browser path.
const encoded = jpeg.encode(
  { data: Buffer.from(ocrData), width: img.width, height: img.height },
  100,
);
await worker.setParameters({ tessedit_pageseg_mode: '6' as never });
const { data } = await worker.recognize(encoded.data as Buffer, {}, { tsv: true });

const tsv = typeof data.tsv === 'string' ? data.tsv : '';
const words: OcrWord[] = [];
for (const line of tsv.split('\n').slice(1)) {
  const cols = line.split('\t');
  if (cols.length < 12) continue;
  if (cols[0] !== '5') continue; // word level
  const text = cols.slice(11).join('\t').trim();
  if (!text) continue;
  const left = Number(cols[6]);
  const top = Number(cols[7]);
  const width = Number(cols[8]);
  const height = Number(cols[9]);
  const conf = Number(cols[10]);
  words.push({ text, x0: left, y0: top, x1: left + width, y1: top + height, conf });
}

console.log(`words: ${words.length}`);
const headerText = words
  .filter((w) => w.y0 < grid.table.top)
  .map((w) => w.text)
  .join(' ');
console.log('title text:', headerText.slice(0, 160));

const table = assembleTable(words, grid);
console.log(`template: ${table.template.id} (header score ${table.headerScore.toFixed(2)})`);
console.log('warnings:', table.warnings);
console.log('header:', table.headerCells.join(' | '));

for (const record of table.records) {
  const normalized = normalizeRow(table.template as SheetTemplate, record);
  const v = normalized.values;
  const group = String(v.group_code ?? '');
  console.log(
    `[${group}] line=${v.line_number ?? '-'} name=${String(v.customer_name ?? '-').slice(0, 26)} phone=${v.customer_phone ?? '-'} xaafada=${v.xaafada ?? '-'} box=${v.cablebox_code_raw ?? '-'} shaqada=${v.work_subtype ?? '-'} complain=${v.complain_type ?? '-'} date=${v.reported_date ?? '-'}`,
  );
}

await worker.terminate();
