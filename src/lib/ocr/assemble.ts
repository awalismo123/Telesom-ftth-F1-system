/**
 * Turns positioned OCR words + a detected ruled grid into a rectangular table
 * of cells, then maps those cells onto a Telesom report template.
 */

import type { Band, GridModel } from './imageOps';
import {
  detectTemplateFromHeaders,
  matchHeaderRowScored,
  getTemplate,
  scoreTemplate,
  type SheetTemplate,
} from './templates';

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
}

export interface CellGrid {
  /** rows[r][c] = joined text of the cell */
  rows: string[][];
  rowBands: Band[];
  colBands: Band[];
}

function bandIndexFor(bands: Band[], value: number): number {
  if (!bands.length) return -1;
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const band = bands[mid];
    if (value < band.start) hi = mid - 1;
    else if (value > band.end) lo = mid + 1;
    else return mid;
  }
  const nearest = lo < bands.length ? lo : bands.length - 1;
  const centre = bands[nearest].center;
  const tolerance = Math.max(6, (bands[nearest].end - bands[nearest].start) * 0.25);
  return Math.abs(value - centre) <= tolerance ? nearest : -1;
}

function joinWords(words: OcrWord[]): string {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return sorted
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group words into cells of the detected grid.
 *
 * Assignment is by *overlap area* rather than by word centre: a word printed
 * against a cell border (very common in these narrow numeric columns) still
 * lands in the cell that physically contains most of it.
 */
export function assignWordsToGrid(words: OcrWord[], grid: GridModel): CellGrid {
  const rowCount = grid.rowBands.length;
  const colCount = grid.colBands.length;

  const buckets: OcrWord[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => [] as OcrWord[]),
  );

  for (const word of words) {
    const cx = (word.x0 + word.x1) / 2;
    const cy = (word.y0 + word.y1) / 2;
    if (cx < grid.table.left - 4 || cx > grid.table.right + 4) continue;
    if (cy < grid.table.top || cy > grid.table.bottom) continue;

    // Rows: overlap on the y axis (fall back to centre proximity).
    let bestRow = -1;
    let bestRowOverlap = 0;
    for (let r = 0; r < rowCount; r++) {
      const band = grid.rowBands[r];
      const overlap = Math.min(word.y1, band.end) - Math.max(word.y0, band.start);
      if (overlap > bestRowOverlap) {
        bestRowOverlap = overlap;
        bestRow = r;
      }
    }
    if (bestRow < 0 || bestRowOverlap <= 0) {
      bestRow = bandIndexFor(grid.rowBands, cy);
    }
    if (bestRow < 0) continue;

    // Columns: overlap on the x axis, allowing a small crop tolerance.
    let bestCol = -1;
    let bestColOverlap = 0;
    for (let c = 0; c < colCount; c++) {
      const band = grid.colBands[c];
      const overlap = Math.min(word.x1, band.end + 3) - Math.max(word.x0, band.start - 3);
      if (overlap > bestColOverlap) {
        bestColOverlap = overlap;
        bestCol = c;
      }
    }
    if (bestCol < 0 || bestColOverlap <= 0) {
      bestCol = bandIndexFor(grid.colBands, cx);
    }
    if (bestCol < 0) {
      bestCol = cx < grid.colBands[0].start ? 0 : colCount - 1;
    }

    buckets[bestRow][bestCol].push(word);
  }

  const rows = buckets.map((cells) => cells.map((words) => joinWords(words)));

  return { rows, rowBands: grid.rowBands, colBands: grid.colBands };
}

/**
 * Fallback used when the picture has no detectable ruled grid
 * (re-photographed print-outs, cropped screenshots, etc.).
 */
export function buildGridFromWords(words: OcrWord[]): CellGrid {
  if (!words.length) return { rows: [], rowBands: [], colBands: [] };

  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const heights = sorted.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 14;
  const rowTolerance = medianHeight * 0.6;

  const lineGroups: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let currentY = -Infinity;

  for (const w of sorted) {
    if (Math.abs(w.y0 - currentY) <= rowTolerance && current.length) {
      current.push(w);
    } else {
      if (current.length) lineGroups.push(current);
      current = [w];
      currentY = w.y0;
    }
  }
  if (current.length) lineGroups.push(current);

  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));

  const startCounts = new Map<number, number>();
  for (const w of words) {
    const bin = Math.floor((w.x0 - minX) / 4);
    startCounts.set(bin, (startCounts.get(bin) ?? 0) + 1);
  }

  const starts: number[] = [];
  const usedBins = [...startCounts.keys()].sort((a, b) => a - b);
  let lastAccepted = -Infinity;
  for (const bin of usedBins) {
    const count = startCounts.get(bin) ?? 0;
    if (count < Math.max(2, lineGroups.length * 0.25)) continue;
    const x = minX + bin * 4;
    if (x - lastAccepted < medianHeight * 1.2) continue;
    starts.push(x);
    lastAccepted = x;
  }

  const rowBandsOf = (): Band[] =>
    lineGroups.map((g) => {
      const start = Math.min(...g.map((w) => w.y0));
      const end = Math.max(...g.map((w) => w.y1));
      return { start, end, center: Math.round((start + end) / 2) };
    });

  if (starts.length < 2) {
    return {
      rows: lineGroups.map((g) => [g.map((w) => w.text).join(' ')]),
      rowBands: rowBandsOf(),
      colBands: [{ start: minX, end: maxX, center: (minX + maxX) / 2 }],
    };
  }

  const colBands: Band[] = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 2 : maxX + 4;
    return { start: start - 2, end, center: Math.round((start + end) / 2) };
  });

  const rows = lineGroups.map((group) => {
    const cells: string[][] = Array.from({ length: colBands.length }, () => []);
    for (const w of group) {
      const cx = (w.x0 + w.x1) / 2;
      let idx = colBands.findIndex((b) => cx >= b.start && cx <= b.end);
      if (idx < 0) idx = cx < colBands[0].start ? 0 : colBands.length - 1;
      cells[idx].push(w.text);
    }
    return cells.map((c) => c.join(' ').trim());
  });

  return { rows, rowBands: rowBandsOf(), colBands };
}

export interface AnalyzeResult {
  template: SheetTemplate;
  headerIndex: number;
  /** template column index → detected column index (-1 when unmatched) */
  mapping: number[];
  /** detected column index → template column index (null when unmatched) */
  detectedToTemplate: (number | null)[];
  headerCells: string[];
  headerScore: number;
  warnings: string[];
  cellGrid: CellGrid;
  /** data rows only (header removed), cleaned of empty lines */
  dataRows: string[][];
  usedFallbackLayout: boolean;
}

function locateHeader(
  rows: string[][],
  templateHint?: SheetTemplate,
): { headerIndex: number; mapping: number[]; template: SheetTemplate; score: number } {
  let best = {
    headerIndex: -1,
    mapping: [] as number[],
    template: templateHint ?? getTemplate('galinta'),
    score: 0,
  };

  rows.slice(0, Math.min(8, rows.length)).forEach((row, idx) => {
    const cells = row.map((c) => (c ?? '').trim());
    const detected = templateHint
      ? { template: templateHint, score: scoreTemplate(cells, templateHint) }
      : detectTemplateFromHeaders(cells);

    if (detected.score > best.score) {
      best = {
        headerIndex: idx,
        mapping: matchHeaderRowScored(cells, detected.template).mapping,
        template: detected.template,
        score: detected.score,
      };
    }
  });

  return best;
}

/**
 * Fill the gaps in a header mapping.
 *
 * Real sheets often merge two header labels into one visual cell ("XNumber" and
 * "Ref-Number" printed with no divider), or OCR mangles a single label. Without
 * this, an entire column is silently dropped. When the unmatched template
 * columns and the unclaimed detected columns line up one-to-one between two
 * matched neighbours, we re-attach them.
 */
export function gapFillMapping(mapping: number[], detectedCols: number): number[] {
  const out = [...mapping];
  const claimed = new Set(out.filter((i) => i >= 0));

  let i = 0;
  while (i < out.length) {
    if (out[i] >= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] < 0) j++;

    const left = i > 0 ? out[i - 1] : -1;
    const right = j < out.length ? out[j] : detectedCols;
    const free: number[] = [];
    for (let d = left + 1; d < right; d++) {
      if (!claimed.has(d)) free.push(d);
    }

    const needed = j - i;
    if (free.length >= needed && needed > 0) {
      // One-to-one when possible, otherwise keep the left-most alignment.
      const offset = free.length - needed;
      for (let k = 0; k < needed; k++) {
        out[i + k] = free[k + offset];
        claimed.add(free[k + offset]);
      }
    }

    i = j;
  }

  return out;
}

/** Analyse the grid + words: template, header row, column mapping, data rows. */
export function analyzeTable(
  words: OcrWord[],
  grid: GridModel,
  templateHint?: SheetTemplate,
): AnalyzeResult {
  const warnings: string[] = [];
  const usableGrid = grid.rowBands.length >= 2 && grid.colBands.length >= 2;
  const cellGrid = usableGrid ? assignWordsToGrid(words, grid) : buildGridFromWords(words);

  if (!usableGrid) {
    warnings.push(
      'No ruled table lines were detected — rows and columns were estimated from the text layout. Please double-check the extraction.',
    );
  }

  const rows = cellGrid.rows.filter((r) => r.some((c) => (c ?? '').trim().length > 0));
  const header = locateHeader(rows, templateHint);
  const template = templateHint ?? header.template;

  const detectedCols = Math.max(...rows.map((r) => r.length), 0);
  const mapping =
    header.headerIndex >= 0 && header.mapping.some((m) => m >= 0)
      ? gapFillMapping(header.mapping, detectedCols)
      : template.columns.map((_, i) => i);

  // If the header was found in the *filtered* list we must remove it there too.
  const headerRowText = header.headerIndex >= 0 ? rows[header.headerIndex] : [];
  const dataRows = rows.filter((r) => r !== headerRowText);

  const detectedToTemplate: (number | null)[] = Array.from({ length: detectedCols }, () => null);
  mapping.forEach((detectedIdx, templateIdx) => {
    if (detectedIdx >= 0 && detectedIdx < detectedCols) {
      detectedToTemplate[detectedIdx] = templateIdx;
    }
  });

  if (header.headerIndex < 0) {
    warnings.push(
      'Header row was not recognised — columns are assumed to be in the standard sheet order. Please verify the columns below.',
    );
  }

  return {
    template,
    headerIndex: header.headerIndex,
    mapping,
    detectedToTemplate,
    headerCells: headerRowText.map((c) => c ?? ''),
    headerScore: header.score,
    warnings,
    cellGrid,
    dataRows,
    usedFallbackLayout: !usableGrid,
  };
}

/** Cell matrix (data rows only) → template-shaped records. */
export function buildRecordsFromCells(
  dataRows: string[][],
  mapping: number[],
  template: SheetTemplate,
): Record<string, string>[] {
  const records: Record<string, string>[] = [];

  for (const cells of dataRows) {
    const record: Record<string, string> = {};
    let filled = 0;

    template.columns.forEach((col, colIdx) => {
      const detectedIdx = mapping[colIdx];
      const value = detectedIdx >= 0 ? (cells[detectedIdx] ?? '') : '';
      record[col.key] = value;
      if (value) filled++;
    });

    if (filled >= 2) records.push(record);
  }

  return records;
}

export interface AssembledTable {
  template: SheetTemplate;
  records: Record<string, string>[];
  headerCells: string[];
  headerScore: number;
  columnBoundaries: number[];
  warnings: string[];
}

/** Convenience wrapper (used by the dev harness and the fallback path). */
export function assembleTable(
  words: OcrWord[],
  grid: GridModel,
  templateHint?: SheetTemplate,
): AssembledTable {
  const analysis = analyzeTable(words, grid, templateHint);
  return {
    template: analysis.template,
    records: buildRecordsFromCells(analysis.dataRows, analysis.mapping, analysis.template),
    headerCells: analysis.headerCells,
    headerScore: analysis.headerScore,
    columnBoundaries: analysis.cellGrid.colBands.map((b) => b.center),
    warnings: analysis.warnings,
  };
}
