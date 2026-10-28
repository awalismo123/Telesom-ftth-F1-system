/**
 * Offline accuracy lab for the real Telesom daily sheets.
 *
 * Runs the *production* pipeline (src/lib/ocr/pipeline.ts) in Node against the
 * sample pictures, and scores the extraction against the values that are
 * visibly printed on those sheets.
 *
 *   npx tsx scripts/ocr-lab.mts                       # both samples
 *   npx tsx scripts/ocr-lab.mts samples/cilada-sample.jpeg
 *   npx tsx scripts/ocr-lab.mts samples/foo.jpeg --json
 */
import fs from 'node:fs';
import { createWorker, type Worker } from 'tesseract.js';
import jpeg from 'jpeg-js';

import { resizeRgba, rotateRgba, type RgbaImage } from '../src/lib/ocr/imageOps';
import { runPipeline, type OcrRuntime } from '../src/lib/ocr/pipeline';
import { normalizeRow, pickDateFormat } from '../src/lib/ocr/normalize';
import { buildRowsFromRecords } from '../src/lib/ocr/extract';

const LANG_PATH = 'node_modules/@tesseract.js-data/eng/4.0.0_best_int';
const MAX_WIDTH = 2200;

async function makeRuntime(): Promise<{ runtime: OcrRuntime; close: () => Promise<void> }> {
  const worker: Worker = await createWorker('eng', 1, {
    langPath: LANG_PATH,
    cacheMethod: 'none',
    logger: () => {},
  });

  const runtime: OcrRuntime = {
    async recognize(img, opts) {
      await worker.setParameters({
        tessedit_pageseg_mode: opts.psm as never,
        tessedit_char_whitelist: (opts.whitelist ?? '') as never,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      const encoded = jpeg.encode(
        { data: Buffer.from(img.data), width: img.width, height: img.height },
        95,
      );
      const { data } = await worker.recognize(encoded.data as Buffer, {}, { tsv: true });
      const tsv = typeof data.tsv === 'string' ? data.tsv : '';
      const words = [];
      for (const line of tsv.split('\n')) {
        const cols = line.split('\t');
        if (cols.length < 12 || cols[0] !== '5') continue;
        const text = cols.slice(11).join(' ').trim();
        if (!text) continue;
        const conf = Number(cols[10]);
        if (Number.isFinite(conf) && conf < (opts.minConf ?? 25)) continue;
        const left = Number(cols[6]);
        const top = Number(cols[7]);
        const width = Number(cols[8]);
        const height = Number(cols[9]);
        words.push({ text, x0: left, y0: top, x1: left + width, y1: top + height, conf });
      }
      return { text: data.text || '', words, conf: Number(data.confidence ?? 0) };
    },
  };

  return { runtime, close: () => worker.terminate() };
}

function loadImage(file: string): RgbaImage {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true });
  const base: RgbaImage = { data: raw.data, width: raw.width, height: raw.height };
  let scale = MAX_WIDTH / base.width;
  if (scale > 2.2) scale = 2.2;
  if (scale < 0.35) scale = 0.35;
  return scale === 1 ? base : resizeRgba(base, scale);
}

/** Degrade a picture the way a phone camera in the field would. */
function degrade(img: RgbaImage, quality: number, shrink: number): RgbaImage {
  const small = shrink === 1 ? img : resizeRgba(img, shrink);
  const encoded = jpeg.encode(
    { data: Buffer.from(small.data), width: small.width, height: small.height },
    quality,
  );
  const decoded = jpeg.decode(encoded.data, { useTArray: true });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

/* ---------------------------------------------------------------------- */
/* Expected content (read directly off the sample sheets)                 */
/* ---------------------------------------------------------------------- */
type Expect = { line: string; name?: string; phone?: string; group?: string; area?: string };

const CILADA_EXPECTED: Expect[] = [
  { line: '567334', name: 'CISMAAN CABDICASIIS', phone: '634418376', group: 'F3' },
  { line: '520491', name: 'MUSCAB IDIRIS YUUSUF', phone: '634582018', group: 'F1' },
  { line: '573776', name: 'AYAAN MACOW JAYTE', phone: '637244286', group: 'F1' },
  { line: '525257', name: 'DR SALEEBAAN', phone: '8831958', group: 'F1' },
  { line: '574130', name: 'LUXURY CAR', phone: '636103086', group: 'F1' },
  { line: '574093', name: 'ASKAR CAFETERIA', phone: '633497653', group: 'GA' },
  { line: '518963', name: 'XAMDA ISMAACIL', phone: '634246857', group: 'F1' },
  { line: '561872', name: 'CABDIRAXMAAN MAHAD', phone: '634220624', group: 'F3' },
  { line: '541793', name: 'MAYMUUNA SALAAD CALI', phone: '633555466', group: 'F2' },
  { line: '573451', name: 'CARE AND CURE FIBER', phone: '633726479', group: 'F1' },
  { line: '567446', name: 'AXMED MAXAMED', phone: '638311181', group: 'F3' },
  { line: '567346', name: 'XAMSE CABIQAADIR', phone: '634417264', group: 'F3' },
  { line: '568280', name: 'XABIIB MAXAMED XUSEEN', phone: '634147283', group: 'F3' },
  { line: '541717', name: 'KHAALID MUUSE DAGAAL', phone: '634475339', group: 'F2' },
  { line: '575239', name: 'MOHAMEDKADAR', phone: '634738744', group: 'F1' },
  { line: '586213', name: 'FARDUUS XUSEEN XASAN', phone: '634717616', group: 'F3' },
  { line: '573387', name: 'DHAMAYS COLLECTION', phone: '634246298', group: 'F1' },
  { line: '520787', name: 'NAJAX COSTAMATIS', phone: '634395459', group: 'F2' },
  { line: '586557', name: 'MUKHTAAR MAXAMED', phone: '634126281', group: 'F3' },
];

const GALINTA_EXPECTED: Expect[] = [
  { line: '575888', name: 'SALES DEPARTMENT OBSIIYE', phone: '634477140', area: 'GANTALAHA', group: 'F1' },
  { line: '574594', name: 'BARKHAD AXMED FAARAX', phone: '633342635', area: 'JIGJIGAYAR', group: 'F1' },
  { line: '588284', name: 'CANAB FAARAX CAYDIID JAAMAC', phone: '633277158', area: 'WAAHEEN', group: 'F2' },
  { line: '586640', name: 'AYAAN KHADAR DAAHIR MOOGE', phone: '634409425', area: 'CALAAMADAHA', group: 'F3' },
  { line: '575064', name: 'UBAX AXMED JAAMAC MAXAMED', phone: '634314162', area: 'BADA CAS', group: 'F1' },
  { line: '542439', name: 'MUSTAFE XASAN CABDILLAAHI', phone: '638082888', area: 'NEW HARGEISA', group: 'F5' },
  { line: '512057', name: 'AXMED CABDIRAXMAAN XUSEEN', phone: '634220146', area: 'NEW HARGEISA', group: 'F5' },
  { line: '514695', name: 'AXMED NUUR DIRIR DEDICATED', phone: '634310001', area: 'NEW HARGEISA', group: 'F5' },
  { line: '563585', name: 'JAAMAC CIISE MUXUMED MIRE', phone: '634477140', area: 'CABAYE', group: 'F2' },
  { line: '563586', name: 'JAAMAC CIISE MUXUMED MIRE', phone: '634477140', area: '18 MAY', group: 'F3' },
  { line: '543314', name: 'LUULA XASAN HAYBE CIGE', phone: '634782222', area: 'MACALIN HAARUUN', group: 'F2' },
  { line: '586642', name: 'XUSEEN CISMAAN XASAN HARUUN', phone: '633260744', area: 'XIDIGTA', group: 'F3' },
  { line: '588296', name: 'NAJAX COSMETICS', phone: '634831046', area: 'WAAHEEN', group: 'F2' },
];

function letters(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '');
}

function words(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function nameMatches(expected: string, actual: string): boolean {
  const e = words(expected);
  const a = words(actual);
  if (!a.length) return false;
  // Every expected word must have a close counterpart in the reading.
  let hits = 0;
  for (const w of e) {
    if (a.some((cand) => cand === w || lev(cand, w) <= Math.max(1, Math.floor(w.length * 0.25)))) hits++;
  }
  if (hits / e.length >= 0.75) return true;
  const joinedE = letters(expected);
  const joinedA = letters(actual);
  return lev(joinedE, joinedA) <= Math.max(2, Math.floor(joinedE.length * 0.2));
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function scoreRows(
  expected: Expect[],
  actual: Record<string, string | number | null>[],
): Record<string, { ok: number; total: number }> {
  const stats: Record<string, { ok: number; total: number }> = {
    line: { ok: 0, total: 0 },
    name: { ok: 0, total: 0 },
    phone: { ok: 0, total: 0 },
    group: { ok: 0, total: 0 },
    area: { ok: 0, total: 0 },
  };

  for (const exp of expected) {
    const match =
      actual.find((row) => digits(String(row.line_number ?? '')) === exp.line) ??
      actual.find((row) => nameMatches(exp.name ?? '', String(row.customer_name ?? '')));

    stats.line.total++;
    if (match && digits(String(match.line_number ?? '')) === exp.line) stats.line.ok++;

    if (exp.name) {
      stats.name.total++;
      if (match && nameMatches(exp.name, String(match.customer_name ?? ''))) stats.name.ok++;
    }

    if (exp.phone) {
      stats.phone.total++;
      if (match && digits(String(match.customer_phone ?? '')) === exp.phone) stats.phone.ok++;
    }

    if (exp.group) {
      stats.group.total++;
      if (match && String(match.group_code ?? '') === exp.group) stats.group.ok++;
    }

    if (exp.area) {
      stats.area.total++;
      if (match && nameMatches(exp.area, String(match.xaafada ?? ''))) stats.area.ok++;
    }
  }

  return stats;
}

async function runFile(
  file: string,
  runtime: OcrRuntime,
  options: { degrade?: { quality: number; shrink: number }; label?: string },
) {
  let img = loadImage(file);
  if (options.degrade) img = degrade(img, options.degrade.quality, options.degrade.shrink);

  const result = await runPipeline(runtime, img, {});
  const dateFormat = pickDateFormat(result.records.map((r) => r.reported_date ?? ''));
  const normalized = result.records.map(
    (record) => normalizeRow(result.template, record, dateFormat).values,
  );

  const expected = result.template.id === 'cilada' ? CILADA_EXPECTED : GALINTA_EXPECTED;
  const stats = scoreRows(expected, normalized);

  const label = options.label ?? file.split('/').pop()!;
  console.log(`\n=== ${label} ===`);
  console.log(
    `template=${result.template.id} headerScore=${result.headerScore.toFixed(2)} rows=${result.records.length}/${expected.length} ` +
      `filled=${result.stats.filledCells}/${result.stats.totalCells} ` +
      `columns=${result.stats.columnPasses} repaired=${result.stats.repairedCells} skew=${result.skewCorrected}° offset=${result.alignmentOffset} (${result.elapsedMs} ms)`,
  );
  console.log(
    'per-column: ' +
      result.stats.perColumn
        .map((c) => `${c.label} ${c.filled}/${c.total}${c.weak ? '!' : ''}`)
        .join('  '),
  );
  const pct = (s: { ok: number; total: number }) =>
    s.total ? `${Math.round((s.ok / s.total) * 100)}% (${s.ok}/${s.total})` : 'n/a';
  console.log(
    `accuracy → line ${pct(stats.line)} · name ${pct(stats.name)} · phone ${pct(stats.phone)} · group ${pct(stats.group)} · area ${pct(stats.area)}`,
  );

  // Show the rows that still have gaps.
  const gaps = normalized.filter(
    (row) => !row.line_number || !row.customer_name || !row.group_code,
  );
  if (gaps.length) {
    for (const row of gaps.slice(0, 8)) {
      console.log(
        `  gap: line=${row.line_number ?? '-'} name=${String(row.customer_name ?? '-').slice(0, 24)} group=${row.group_code ?? '-'}`,
      );
    }
  }

  return { result, stats, normalized };
}

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));

const { runtime, close } = await makeRuntime();
const targets = files.length ? files : ['samples/cilada-sample.jpeg', 'samples/galinta-sample.jpeg'];

for (const file of targets) {
  await runFile(file, runtime, {});
}

// Skew simulation: rotate the sheet the way a hand-held photo would be.
if (!files.length) {
  for (const file of targets) {
    const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true });
    const base: RgbaImage = { data: raw.data, width: raw.width, height: raw.height };
    const scaled = resizeRgba(base, Math.min(1, 2200 / base.width));
    const rotated = rotateRgba(scaled, 1.5);
    const path = `scripts/tmp/rotated-${file.split('/').pop()}`;
    fs.writeFileSync(path, jpeg.encode({ data: Buffer.from(rotated.data), width: rotated.width, height: rotated.height }, 90).data);
    await runFile(path, runtime, { label: `${file.split('/').pop()} (rotated 1.5°)` });
  }
}

// Field-photo simulation: smaller + heavily compressed JPEG.
if (!files.length) {
  for (const file of targets) {
    await runFile(file, runtime, {
      degrade: { quality: 45, shrink: 0.72 },
      label: `${file.split('/').pop()} (degraded 72% · q45)`,
    });
  }
}

await close();
