/**
 * Pure image-processing helpers used by the table OCR pipeline.
 *
 * Deliberately DOM-free: they operate on raw RGBA buffers so the exact same
 * code path can run in the browser (via <canvas> ImageData) and in Node
 * (via a JPEG decoder) while we tune the extraction against real sheets.
 */

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BinaryMask {
  data: Uint8Array; // 1 = ink, 0 = paper
  width: number;
  height: number;
}

/** Rec. 601 luma. */
export function toGray(img: RgbaImage): GrayImage {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return { data: out, width, height };
}

/** Otsu's method — global threshold that works well on flat table scans. */
export function otsuThreshold(gray: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++;

  const total = gray.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }

  // Nudge slightly below Otsu so anti-aliased grid lines survive.
  return Math.min(255, Math.max(1, best + 8));
}

export function binarize(gray: GrayImage, threshold: number): BinaryMask {
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) {
    out[i] = gray.data[i] <= threshold ? 1 : 0;
  }
  return { data: out, width: gray.width, height: gray.height };
}

export interface Band {
  /** inclusive start pixel */
  start: number;
  /** inclusive end pixel */
  end: number;
  /** centre pixel */
  center: number;
}

function groupRuns(indices: number[]): Band[] {
  const bands: Band[] = [];
  if (indices.length === 0) return bands;

  let runStart = indices[0];
  let prev = indices[0];

  for (let i = 1; i < indices.length; i++) {
    const cur = indices[i];
    if (cur - prev <= 1) {
      prev = cur;
      continue;
    }
    bands.push({ start: runStart, end: prev, center: Math.round((runStart + prev) / 2) });
    runStart = cur;
    prev = cur;
  }
  bands.push({ start: runStart, end: prev, center: Math.round((runStart + prev) / 2) });
  return bands;
}

export interface GridModel {
  /** Y bands of ruled horizontal lines (table borders). */
  horizontalLines: Band[];
  /** X bands of ruled vertical lines (column separators). */
  verticalLines: Band[];
  /** Row strips between horizontal rules. */
  rowBands: Band[];
  /** Column strips between vertical rules. */
  colBands: Band[];
  /** Detected table bounding box. */
  table: { left: number; top: number; right: number; bottom: number };
  /** 0..1 heuristic on how table-like the detection looks. */
  confidence: number;
}

/**
 * Detect ruled table lines.
 *
 * Uses the fact that a border line is a long *continuous* run of ink: we count
 * ink per row/column and require a high fill ratio, which rejects the Telesom
 * logo and the green title underline (only ~40% of the page width).
 */
export function detectGrid(mask: BinaryMask, opts?: { minLineRatio?: number }): GridModel {
  const { data, width, height } = mask;
  const minLineRatio = opts?.minLineRatio ?? 0.55;

  // ---- horizontal rules -------------------------------------------------
  const rowInk = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let ink = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) ink += data[base + x];
    rowInk[y] = ink;
  }

  const maxRowInk = Math.max(...rowInk);
  const hCandidates: number[] = [];
  for (let y = 0; y < height; y++) {
    if (maxRowInk > 0 && rowInk[y] / maxRowInk >= minLineRatio) hCandidates.push(y);
  }

  let horizontalLines = groupRuns(hCandidates);

  // Keep only the dominant block of rules (the table), ignoring stray rules
  // far above/below (page borders, footer marks).
  if (horizontalLines.length > 4) {
    let bestStart = 0;
    let bestEnd = 0;
    let bestScore = -1;
    for (let i = 0; i < horizontalLines.length; i++) {
      let j = i;
      while (
        j + 1 < horizontalLines.length &&
        horizontalLines[j + 1].start - horizontalLines[j].end < height * 0.25
      ) {
        j++;
      }
      const score = j - i;
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
        bestEnd = j;
      }
      i = j;
    }
    horizontalLines = horizontalLines.slice(bestStart, bestEnd + 1);
  }

  const tableTop = horizontalLines.length ? horizontalLines[0].start : 0;
  const tableBottom = horizontalLines.length
    ? horizontalLines[horizontalLines.length - 1].end
    : height - 1;
  const tableHeight = Math.max(1, tableBottom - tableTop + 1);

  // ---- vertical rules (measured only inside the table body) --------------
  const colInk = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let ink = 0;
    for (let y = tableTop; y <= tableBottom; y++) ink += data[y * width + x];
    colInk[x] = ink;
  }

  const vCandidates: number[] = [];
  for (let x = 0; x < width; x++) {
    if (colInk[x] / tableHeight >= minLineRatio) vCandidates.push(x);
  }
  let verticalLines = groupRuns(vCandidates);

  if (verticalLines.length < 2) {
    // Fallback: relax the requirement — vertical rules are often interrupted
    // by merged cells (the Cablebox column in the Cilada sheet does this).
    const relaxed = 0.32;
    const v2: number[] = [];
    for (let x = 0; x < width; x++) if (colInk[x] / tableHeight >= relaxed) v2.push(x);
    const grouped = groupRuns(v2);
    if (grouped.length >= 2) verticalLines = grouped;
  }

  const tableLeft = verticalLines.length ? verticalLines[0].start : 0;
  const tableRight = verticalLines.length
    ? verticalLines[verticalLines.length - 1].end
    : width - 1;

  // ---- build row / column strips ----------------------------------------
  const rowBands: Band[] = [];
  for (let i = 0; i < horizontalLines.length - 1; i++) {
    const start = horizontalLines[i].end + 1;
    const end = horizontalLines[i + 1].start - 1;
    if (end - start >= 4) rowBands.push({ start, end, center: Math.round((start + end) / 2) });
  }

  const colBands: Band[] = [];
  for (let i = 0; i < verticalLines.length - 1; i++) {
    const start = verticalLines[i].end + 1;
    const end = verticalLines[i + 1].start - 1;
    if (end - start >= 4) colBands.push({ start, end, center: Math.round((start + end) / 2) });
  }

  const confidence =
    horizontalLines.length >= 3 && verticalLines.length >= 3
      ? Math.min(1, (horizontalLines.length + verticalLines.length) / 24)
      : 0;

  return {
    horizontalLines,
    verticalLines,
    rowBands,
    colBands,
    table: { left: tableLeft, top: tableTop, right: tableRight, bottom: tableBottom },
    confidence,
  };
}

/**
 * Erase the ruled table lines from a binarised image.
 *
 * This is the single biggest accuracy win for table OCR: without it Tesseract
 * reads every column separator as `I`/`l` and every border as `_`, which
 * collapses whole rows into garbage. Text glyphs are kept intact because the
 * erosion band only covers the detected rule plus a 2px halo.
 */
export function removeRules(mask: BinaryMask, grid: GridModel, pad = 2): BinaryMask {
  const { width, height } = mask;
  const out = new Uint8Array(mask.data);

  const clearRows = (from: number, to: number) => {
    const y0 = Math.max(0, from);
    const y1 = Math.min(height - 1, to);
    for (let y = y0; y <= y1; y++) out.fill(0, y * width, (y + 1) * width);
  };

  const clearCols = (from: number, to: number) => {
    const x0 = Math.max(0, from);
    const x1 = Math.min(width - 1, to);
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < height; y++) out[y * width + x] = 0;
    }
  };

  for (const band of grid.horizontalLines) clearRows(band.start - pad, band.end + pad);
  for (const band of grid.verticalLines) clearCols(band.start - pad, band.end + pad);

  return { data: out, width, height };
}

/** Binary mask → white-background RGBA (what Tesseract should be fed). */
export function maskToRgba(mask: BinaryMask): RgbaImage {
  const out = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i] ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: mask.width, height: mask.height };
}

/** Bilinear upscale — helps Tesseract a lot on ~14px table text. */
export function resizeRgba(img: RgbaImage, scale: number): RgbaImage {
  if (scale === 1) return img;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = img;

  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, y / scale);
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;

    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, x / scale);
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - wx) + data[i10 + c] * wx;
        const bottom = data[i01 + c] * (1 - wx) + data[i11 + c] * wx;
        out[o + c] = top * (1 - wy) + bottom * wy;
      }
      out[o + 3] = 255;
    }
  }

  return { data: out, width, height };
}
