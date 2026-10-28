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
  // Binary search for the band containing value.
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const band = bands[mid];
    if (value < band.start) hi = mid - 1;
    else if (value > band.end) lo = mid + 1;
    else return mid;
  }
  // Snap to nearest band when the word centre falls on a rule.
  const nearest = lo < bands.length ? lo : bands.length - 1;
  const centre = bands[nearest].center;
  const tolerance = Math.max(6, (bands[nearest].end - bands[nearest].start) * 0.25);
  return Math.abs(value - centre) <= tolerance ? nearest : -1;
}

/** Group words into cells of the detected grid. */
export function assignWordsToGrid(words: OcrWord[], grid: GridModel): CellGrid {
  const rowCount = grid.rowBands.length;
  const colCount = grid.colBands.length;

  const buckets: OcrWord[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => [] as OcrWord[]),
  );

  for (const word of words) {
    const cx = (word.x0 + word.x1) / 2;
    const cy = (word.y0 + word.y1) / 2;
    if (cx < grid.table.left || cx > grid.table.right) continue;

    const r = bandIndexFor(grid.rowBands, cy);
    if (r < 0) continue;
    const c = bandIndexFor(grid.colBands, cx);
    if (c < 0) continue;

    buckets[r][c].push(word);
  }

  const rows = buckets.map((cells) =>
    cells.map((words) => {
      const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      // Preserve visual lines with a newline so wrapped cells stay readable.
      let out = '';
      let lastY = -1;
      for (const w of sorted) {
        if (lastY >= 0) {
          const lineHeight = Math.max(6, w.y1 - w.y0);
          out += Math.abs(w.y0 - lastY) > lineHeight * 0.6 ? ' ' : ' ';
        }
        out += w.text;
        if (lastY < 0) lastY = w.y0;
      }
      return out.replace(/\s+/g, ' ').trim();
    }),
  );

  return { rows, rowBands: grid.rowBands, colBands: grid.colBands };
}

/**
 * Fallback used when the picture has no detectable ruled grid
 * (re-photographed print-outs, cropped screenshots, etc.).
 * Cluster words into rows by vertical position, then into columns by
 * projecting the word boxes onto the x axis and splitting at empty gutters.
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

  // Columns: histogram of x-start positions across all lines, then find the
  // left-most alignment of each column by looking at large horizontal gaps.
  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));
  const binCount = Math.max(1, Math.round((maxX - minX) / 4));
  const occupied = new Uint8Array(binCount + 1);

  for (const w of words) {
    const startBin = Math.floor((w.x0 - minX) / 4);
    const endBin = Math.ceil((w.x1 - minX) / 4);
    for (let b = startBin; b <= endBin && b < occupied.length; b++) occupied[b] = 1;
  }

  // Column starts: a gutter of >= 12px empty space followed by ink, where the
  // ink column is a "start" position of many words.
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

  if (starts.length < 2) {
    return {
      rows: lineGroups.map((g) => [g.map((w) => w.text).join(' ')]),
      rowBands: lineGroups.map((g, i) => ({
        start: Math.min(...g.map((w) => w.y0)),
        end: Math.max(...g.map((w) => w.y1)),
        center: i,
      })),
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

  const rowBands: Band[] = lineGroups.map((g) => {
    const start = Math.min(...g.map((w) => w.y0));
    const end = Math.max(...g.map((w) => w.y1));
    return { start, end, center: Math.round((start + end) / 2) };
  });

  return { rows, rowBands, colBands };
}

export interface AssembledTable {
  template: SheetTemplate;
  /** Template column key → value for each extracted row. */
  records: Record<string, string>[];
  /** Detected header labels (for the "what did we read" panel). */
  headerCells: string[];
  headerScore: number;
  columnBoundaries: number[];
  warnings: string[];
}

function cellTexts(row: string[]): string[] {
  return row.map((c) => (c ?? '').trim());
}

/** Find the header row (if any) and map template columns onto detected columns. */
function locateHeader(
  rows: string[][],
  templateHint?: SheetTemplate,
): {
  headerIndex: number;
  mapping: number[];
  template: SheetTemplate;
  score: number;
} {
  let best = {
    headerIndex: -1,
    mapping: [] as number[],
    template: templateHint ?? getTemplate('galinta'),
    score: 0,
  };

  const candidates = rows.slice(0, Math.min(6, rows.length));

  candidates.forEach((row, idx) => {
    const cells = cellTexts(row);
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
 * Full assembly: grid + words → template-shaped records.
 */
export function assembleTable(
  words: OcrWord[],
  grid: GridModel,
  templateHint?: SheetTemplate,
): AssembledTable {
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
  const dataRows = rows.filter((r) => r !== undefined);
  const startIndex = header.headerIndex >= 0 ? header.headerIndex + 1 : 0;

  // If the header matched, honour it; otherwise assume 1:1 column order.
  const mapping =
    header.headerIndex >= 0 && header.mapping.some((m) => m >= 0)
      ? header.mapping
      : template.columns.map((_, i) => i);

  if (header.headerIndex < 0) {
    warnings.push(
      'Header row was not recognised — columns are assumed to be in the standard sheet order. Use "Fix columns" if they are not.',
    );
  }

  const records: Record<string, string>[] = [];

  for (let i = startIndex; i < dataRows.length; i++) {
    const cells = cellTexts(dataRows[i]);
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

  return {
    template,
    records,
    headerCells: header.headerIndex >= 0 ? cellTexts(dataRows[header.headerIndex]) : [],
    headerScore: header.score,
    columnBoundaries: cellGrid.colBands.map((b) => b.center),
    warnings,
  };
}
