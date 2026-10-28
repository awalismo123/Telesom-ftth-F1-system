/**
 * The table-reading pipeline, free of any DOM/Node specifics.
 *
 * The browser adapter (`engine.ts`) and the offline tuning harness
 * (`scripts/ocr-lab.mts`) both drive this module, so what we measure against
 * the real Telesom pictures is exactly what runs on the supervisor's phone.
 *
 * Three passes:
 *   1. whole table  (PSM 6)  → header row, column mapping, baseline cells
 *   2. per column   (PSM 4)  → re-read each column strip with a character
 *                              whitelist (digits only for line/phone/ID/date)
 *   3. per cell     (PSM 7)  → re-read cells that are still empty, from a
 *                              contrast-stretched grayscale crop
 */

import {
  toGray,
  otsuThreshold,
  binarize,
  detectGrid,
  removeRulesSmart,
  maskToRgba,
  estimateSkew,
  rotateRgba,
  resizeRgba,
  cropImage,
  stretchContrast,
  type GridModel,
  type RgbaImage,
} from './imageOps';
import {
  analyzeTable,
  buildRecordsFromCells,
  type OcrWord,
  type AnalyzeResult,
} from './assemble';
import type { SheetTemplate } from './templates';
import type { ColumnKind } from './templates';
import { chooseBetter, sanitizeCell, scoreText } from './score';
import { realignMapping } from './align';

export interface OcrProgress {
  stage: 'preparing' | 'reading' | 'columns' | 'repair' | 'assembling' | 'done';
  /** 0..1 */
  progress: number;
  message: string;
}

export interface RecognizeOptions {
  psm: string;
  whitelist?: string;
  minConf?: number;
}

export interface RecognizeResult {
  text: string;
  words: OcrWord[];
  conf: number;
}

export interface OcrRuntime {
  recognize(img: RgbaImage, opts: RecognizeOptions): Promise<RecognizeResult>;
}

export interface ColumnFill {
  key: string;
  label: string;
  filled: number;
  total: number;
  /** true when the column produced fewer values than expected */
  weak: boolean;
}

export interface OcrStats {
  words: number;
  columnPasses: number;
  repairedCells: number;
  filledCells: number;
  totalCells: number;
  /** rows on the sheet where fewer than two cells could be read */
  droppedRows: number;
  perColumn: ColumnFill[];
}

export interface PipelineResult {
  template: SheetTemplate;
  records: Record<string, string>[];
  headerCells: string[];
  headerScore: number;
  warnings: string[];
  grid: GridModel;
  cleaned: RgbaImage;
  titleText: string;
  stats: OcrStats;
  /** raw cell matrix (data rows × detected columns) — used for diagnostics */
  cells: string[][];
  mapping: number[];
  detectedToTemplate: (number | null)[];
  /** non-zero when the columns had to be re-aligned */
  alignmentOffset: number;
  /** degrees of rotation that were corrected */
  skewCorrected: number;
  elapsedMs: number;
}

export interface PipelineOptions {
  templateHint?: SheetTemplate;
  columnPass?: boolean;
  repairPass?: boolean;
  maxRepairs?: number;
  onProgress?: (p: OcrProgress) => void;
}

const WHITELISTS: Partial<Record<ColumnKind, string>> = {
  id: '0123456789',
  line: '0123456789',
  phone: '0123456789',
  time: '0123456789:.',
  date: '0123456789/.-',
  group: 'FGA0123456789',
};

/**
 * Repair priority — identity fields first, cosmetic ones last.
 */
const REPAIR_PRIORITY: Record<string, number> = {
  line_number: 0,
  customer_phone: 1,
  customer_name: 2,
  xaafada: 3,
  group_code: 4,
  cablebox_code_raw: 5,
  reported_date: 6,
  reported_time: 7,
  complain_type: 8,
  work_subtype: 9,
  sheet_row_id: 10,
};

function wordsToRowText(words: OcrWord[]): string {
  if (!words.length) return '';
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let refY = -Infinity;
  let refH = 12;

  for (const w of sorted) {
    const h = Math.max(6, w.y1 - w.y0);
    if (current.length && Math.abs(w.y0 - refY) <= Math.max(refH, h) * 0.7) {
      current.push(w);
    } else {
      if (current.length) lines.push(current);
      current = [w];
      refY = w.y0;
      refH = h;
    }
  }
  if (current.length) lines.push(current);

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Choose the better of two readings of the same cell. */
export function betterText(a: string, b: string): string {
  const strip = (v: string) => v.replace(/[^\w]/g, '');
  if (!a) return b;
  if (!b) return a;
  const al = strip(a).length;
  const bl = strip(b).length;
  if (al === 0) return bl === 0 ? a : b;
  if (bl === 0) return a;
  if (al === bl) return a.length >= b.length ? a : b;
  return bl > al ? b : a;
}

export async function runPipeline(
  runtime: OcrRuntime,
  source: RgbaImage,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const started = Date.now();
  const report = options.onProgress ?? (() => {});
  const doColumns = options.columnPass !== false;
  const doRepair = options.repairPass !== false;
  const maxRepairs = options.maxRepairs ?? 60;

  report({ stage: 'preparing', progress: 0.06, message: 'Detecting the table grid…' });

  // 0a. Straighten a hand-held photo before anything else.
  let working = source;
  const probeGray = toGray(source);
  const probeMask = binarize(probeGray, otsuThreshold(probeGray));
  const skew = estimateSkew(probeMask);
  if (skew !== 0) {
    // estimateSkew already returns the *correction* angle.
    working = rotateRgba(source, skew);
    report({ stage: 'preparing', progress: 0.04, message: 'Straightening the picture…' });
  }

  const gray = toGray(working);
  const threshold = otsuThreshold(gray);
  const mask = binarize(gray, threshold);
  const grid = detectGrid(mask);
  const skewApplied = skew;

  report({ stage: 'preparing', progress: 0.12, message: 'Removing grid lines…' });

  const cleaned = maskToRgba(removeRulesSmart(mask, grid));

  const grayRgba: RgbaImage = {
    data: (() => {
      const g = new Uint8ClampedArray(gray.width * gray.height * 4);
      for (let i = 0; i < gray.data.length; i++) {
        const v = gray.data[i];
        g[i * 4] = v;
        g[i * 4 + 1] = v;
        g[i * 4 + 2] = v;
        g[i * 4 + 3] = 255;
      }
      return g;
    })(),
    width: gray.width,
    height: gray.height,
  };

  report({ stage: 'reading', progress: 0.16, message: 'Reading the table…' });

  const global = await runtime.recognize(cleaned, { psm: '6' });
  const analysis: AnalyzeResult = analyzeTable(global.words, grid, options.templateHint);
  const template = analysis.template;
  const rowCount = analysis.dataRows.length;
  const colCount = analysis.cellGrid.colBands.length;

  const cells: string[][] = analysis.dataRows.map((row) => {
    const copy = new Array<string>(colCount).fill('');
    for (let c = 0; c < colCount; c++) copy[c] = row[c] ?? '';
    return copy;
  });

  let columnPasses = 0;
  let repaired = 0;

  const rowBands = analysis.cellGrid.rowBands;
  const dataRowBands = rowBands.slice(rowBands.length - rowCount);
  const colBands = analysis.cellGrid.colBands;

  /* ------------------------------------------------------------------ */
  /* Pass 2 — per column                                                */
  /* ------------------------------------------------------------------ */
  const canUseColumns =
    doColumns &&
    !analysis.usedFallbackLayout &&
    colCount >= 3 &&
    colCount <= 24 &&
    rowCount >= 1 &&
    rowCount <= 80;

  if (canUseColumns) {
    report({ stage: 'columns', progress: 0.5, message: 'Re-reading each column…' });

    const tableTop = dataRowBands[0].start;
    const tableBottom = dataRowBands[dataRowBands.length - 1].end;

    for (let c = 0; c < colCount; c++) {
      const band = colBands[c];
      const templateIdx = analysis.detectedToTemplate[c];
      const kind = templateIdx !== null ? template.columns[templateIdx].kind : undefined;
      const whitelist = kind ? WHITELISTS[kind] : undefined;

      // Inset by 3px: the anti-aliased remains of the cell border otherwise get
      // read as a leading "1" / "|" and corrupt the numeric columns.
      const inset = 3;
      const x = Math.max(0, band.start + inset);
      const w = Math.max(4, band.end - band.start + 1 - inset * 2);
      const h = Math.max(4, tableBottom - tableTop + 1);

      let strip = cropImage(cleaned, { x, y: tableTop, w, h }, 0);
      const zoom = w < 90 ? 2 : 1;
      if (zoom > 1) strip = resizeRgba(strip, zoom);

      try {
        const res = await runtime.recognize(strip, { psm: '4', whitelist, minConf: 20 });
        const stripWords = res.words.map((word) => ({
          ...word,
          x0: word.x0 / zoom + x,
          x1: word.x1 / zoom + x,
          y0: word.y0 / zoom + tableTop,
          y1: word.y1 / zoom + tableTop,
        }));

        for (let r = 0; r < rowCount; r++) {
          const rowBand = dataRowBands[r];
          const inRow = stripWords.filter(
            (word) =>
              Math.min(word.y1, rowBand.end) - Math.max(word.y0, rowBand.start) > 0,
          );
          const text = wordsToRowText(inRow);
          if (!text) continue;
          cells[r][c] = chooseBetter(kind, cells[r][c] ?? '', text);
        }
        columnPasses++;
      } catch {
        // one bad strip must never break an import
      }

      report({
        stage: 'columns',
        progress: 0.5 + ((c + 1) / colCount) * 0.3,
        message: `Column ${c + 1} of ${colCount}…`,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pass 3 — repair empty cells                                        */
  /* ------------------------------------------------------------------ */
  if (doRepair && !analysis.usedFallbackLayout && rowCount > 0) {
    type Target = { row: number; col: number; kind?: ColumnKind; key: string; order: number };
    const targets: Target[] = [];

    for (let c = 0; c < colCount; c++) {
      const templateIdx = analysis.detectedToTemplate[c];
      const col = templateIdx !== null ? template.columns[templateIdx] : null;
      for (let r = 0; r < rowCount; r++) {
        if ((cells[r][c] ?? '').trim()) continue;
        const key = col?.key ?? `col${c}`;
        targets.push({ row: r, col: c, kind: col?.kind, key, order: REPAIR_PRIORITY[key] ?? 50 });
      }
    }

    targets.sort((a, b) => a.order - b.order);
    const limited = targets.slice(0, maxRepairs);

    if (limited.length) {
      report({
        stage: 'repair',
        progress: 0.82,
        message: `Re-reading ${limited.length} missing cell(s)…`,
      });
    }

    for (let i = 0; i < limited.length; i++) {
      const target = limited[i];
      const band = colBands[target.col];
      const rowBand = dataRowBands[target.row];
      if (!band || !rowBand) continue;

      const inset = 3;
      // The first data row sometimes has its text printed over the header rule
      // (the Cilada "Number" + phone overlap). Give it extra head-room.
      const headRoom = target.row === 0 ? Math.round((rowBand.end - rowBand.start) * 0.35) : 0;
      const rect = {
        x: band.start + inset,
        y: Math.max(0, rowBand.start + inset - headRoom),
        w: Math.max(3, band.end - band.start - inset * 2),
        h: Math.max(3, rowBand.end - rowBand.start - inset * 2 + headRoom),
      };

      const crop = cropImage(grayRgba, rect, 4);
      if (crop.width < 6 || crop.height < 6) continue;

      const zoom = Math.min(5, Math.max(1, 72 / crop.height));
      const scaled = resizeRgba(stretchContrast(crop), zoom);

      const whitelist = target.kind ? WHITELISTS[target.kind] : undefined;

      try {
        const res = await runtime.recognize(scaled, { psm: '7', whitelist });

        // Single-line mode often keeps the trailing junk; keep the first line.
        const text = (res.text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
        if (text && res.conf >= 20) {
          const scored = scoreText(target.kind, text);
          const current = scoreText(target.kind, cells[target.row][target.col] ?? '');
          if (scored.score > current.score) {
            cells[target.row][target.col] = scored.text || text;
            repaired++;
          }
        }
      } catch {
        // ignore individual failures
      }

      if (i % 4 === 0) {
        report({
          stage: 'repair',
          progress: 0.82 + (i / Math.max(1, limited.length)) * 0.14,
          message: `Re-reading missing cells… ${i + 1}/${limited.length}`,
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Assemble                                                           */
  /* ------------------------------------------------------------------ */
  report({ stage: 'assembling', progress: 0.97, message: 'Sorting cells into columns…' });

  const warnings = [...analysis.warnings];

  // Guard against a missed/extra divider shifting every column by one.
  const alignment = realignMapping(cells, analysis.mapping, template, colCount);

  // Never let a below-threshold reading (e.g. a 5-digit "phone") into the data.
  const kinds = template.columns.map((c) => c.kind);
  const sanitized = cells.map((row) =>
    row.map((cell, idx) => {
      const templateIdx = alignment.mapping.indexOf(idx);
      const kind = templateIdx >= 0 ? kinds[templateIdx] : undefined;
      return sanitizeCell(kind, cell);
    }),
  );

  // Rows where nothing at all could be read are skipped (they would import as
  // empty tickets) — but the supervisor must be told, not left guessing.
  const droppedRows = sanitized.filter(
    (row) => row.filter((cell) => (cell ?? '').trim()).length < 2,
  ).length;
  if (droppedRows > 0) {
    warnings.push(
      `${droppedRows} row(s) on the sheet could not be read at all and were skipped. Retake the picture in better light, or add the row by hand.`,
    );
  }

  let records = buildRecordsFromCells(sanitized, alignment.mapping, template);

  const totalCells = rowCount * colCount;
  let filledCells = 0;
  for (const row of sanitized) for (const cell of row) if ((cell ?? '').trim()) filledCells++;

  // Columns that are legitimately often blank on these sheets.
  const OPTIONAL_KINDS = new Set(['date', 'time']);

  const perColumn: ColumnFill[] = template.columns.map((col, templateIdx) => {
    const detectedIdx = alignment.mapping[templateIdx];
    let filled = 0;
    if (detectedIdx >= 0) {
      for (const row of sanitized) if ((row[detectedIdx] ?? '').trim()) filled++;
    }
    return {
      key: col.key,
      label: col.labelEn,
      filled,
      total: rowCount,
      weak:
        rowCount > 0 &&
        filled > 0 &&
        filled < rowCount * 0.6 &&
        !OPTIONAL_KINDS.has(col.kind),
    };
  });

  if (alignment.offset !== 0) {
    warnings.push(
      `The detected table lines did not line up with the columns, so the columns were re-aligned (offset ${alignment.offset > 0 ? '+' : ''}${alignment.offset}). Please double-check a couple of rows below.`,
    );
  }

  const weakColumns = perColumn.filter((c) => c.weak);
  if (weakColumns.length) {
    warnings.push(
      `Some cells could not be read reliably in: ${weakColumns
        .map((c) => `${c.label} (${c.filled}/${c.total})`)
        .join(', ')}. They are highlighted below — tap a cell to type the correct value.`,
    );
  }

  const missingCore = perColumn.filter(
    (c) => (c.key === 'line_number' || c.key === 'customer_name') && c.filled < rowCount,
  );
  if (missingCore.length) {
    warnings.push(
      `${rowCount - Math.min(...missingCore.map((c) => c.filled))} row(s) are missing a line number or customer name. Type them in, or remove the row with the bin icon.`,
    );
  }

  const titleText = (global.text || '')
    .split('\n')
    .slice(0, 4)
    .join(' ')
    .trim();

  report({ stage: 'done', progress: 1, message: 'Done' });

  return {
    template,
    records,
    headerCells: analysis.headerCells,
    headerScore: analysis.headerScore,
    warnings,
    grid,
    cleaned,
    titleText,
    cells: sanitized,
    mapping: alignment.mapping,
    detectedToTemplate: analysis.detectedToTemplate,
    alignmentOffset: alignment.offset,
    skewCorrected: skewApplied,
    stats: {
      words: global.words.length,
      columnPasses,
      repairedCells: repaired,
      filledCells,
      droppedRows,
      totalCells,
      perColumn,
    },
    elapsedMs: Date.now() - started,
  };
}
