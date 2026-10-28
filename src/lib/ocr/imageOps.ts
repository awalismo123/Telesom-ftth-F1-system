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

/**
 * Rule removal that only deletes the *rules themselves*.
 *
 * A plain band-based eraser also removes glyph pixels that touch a border
 * (phones printed tight against the cell edge), which is exactly how columns
 * end up empty. Here a pixel is only cleared when it belongs to a long
 * horizontal/vertical run of ink — i.e. it is part of a ruled line, not a
 * letter (letters never produce 40+ px runs).
 */
export function removeRulesSmart(
  mask: BinaryMask,
  grid: GridModel,
  opts?: { minH?: number; minV?: number },
): BinaryMask {
  const { width, height } = mask;
  const out = new Uint8Array(mask.data);
  const minH = opts?.minH ?? Math.max(24, Math.round(width * 0.02));
  const minV = opts?.minV ?? Math.max(40, Math.round(height * 0.02));

  const inH = new Uint8Array(height);
  for (const band of grid.horizontalLines) {
    for (let y = Math.max(0, band.start - 1); y <= Math.min(height - 1, band.end + 1); y++) {
      inH[y] = 1;
    }
  }

  // Horizontal runs inside the detected rule rows.
  for (let y = 0; y < height; y++) {
    if (!inH[y]) continue;
    const base = y * width;
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const ink = x < width ? out[base + x] : 0;
      if (ink) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        if (x - runStart >= minH) out.fill(0, base + runStart, base + x);
        runStart = -1;
      }
    }
  }

  const inV = new Uint8Array(width);
  for (const band of grid.verticalLines) {
    for (let x = Math.max(0, band.start - 1); x <= Math.min(width - 1, band.end + 1); x++) {
      inV[x] = 1;
    }
  }

  // Vertical runs inside the detected rule columns.
  for (let x = 0; x < width; x++) {
    if (!inV[x]) continue;
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      const ink = y < height ? out[y * width + x] : 0;
      if (ink) {
        if (runStart < 0) runStart = y;
      } else if (runStart >= 0) {
        if (y - runStart >= minV) {
          for (let yy = runStart; yy < y; yy++) out[yy * width + x] = 0;
        }
        runStart = -1;
      }
    }
  }

  return { data: out, width, height };
}

/** Crop a rectangle out of an image, optionally padding with white. */
export function cropImage(
  img: RgbaImage,
  rect: { x: number; y: number; w: number; h: number },
  pad = 0,
  paper: [number, number, number] = [255, 255, 255],
): RgbaImage {
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const outW = w + pad * 2;
  const outH = h + pad * 2;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let i = 0; i < outW * outH; i++) {
    out[i * 4] = paper[0];
    out[i * 4 + 1] = paper[1];
    out[i * 4 + 2] = paper[2];
    out[i * 4 + 3] = 255;
  }

  for (let y = 0; y < h; y++) {
    const sy = Math.round(rect.y) + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = Math.round(rect.x) + x;
      if (sx < 0 || sx >= img.width) continue;
      const src = (sy * img.width + sx) * 4;
      const dst = ((y + pad) * outW + (x + pad)) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH };
}

/** Stretch contrast between the darkest/lightest pixel of a crop. */
export function stretchContrast(img: RgbaImage): RgbaImage {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.round(((img.data[i + c] - lo) / span) * 255);
    }
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
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

/**
 * Estimate how far a photographed sheet is rotated.
 *
 * Scores candidate angles by how strongly the ink concentrates into rows: when
 * the table is straight, each ruled border lands in a single scanline, so the
 * sum of squared row projections peaks. Runs on a subsampled grid, so it costs
 * a few milliseconds even for a 2200px picture.
 */
export function estimateSkew(mask: BinaryMask, maxDegrees = 2.5, step = 0.5): number {
  const { width, height } = mask;
  const stepPx = Math.max(1, Math.round(width / 700)); // subsample horizontally
  let best = { angle: 0, score: -1 };

  for (let angle = -maxDegrees; angle <= maxDegrees + 1e-9; angle += step) {
    const rad = (angle * Math.PI) / 180;
    const tan = Math.tan(rad);
    const offsetRange = Math.ceil(Math.abs(tan) * width) + 2;
    const proj = new Float64Array(height + offsetRange * 2);
    const base = offsetRange;

    for (let y = 0; y < height; y += 2) {
      const rowBase = y * width;
      for (let x = 0; x < width; x += stepPx) {
        if (!mask.data[rowBase + x]) continue;
        const shift = Math.round(x * tan);
        const idx = y + shift + base;
        if (idx >= 0 && idx < proj.length) proj[idx] += 1;
      }
    }

    let sum = 0;
    let sq = 0;
    for (let i = 0; i < proj.length; i++) {
      sum += proj[i];
      sq += proj[i] * proj[i];
    }
    // Concentration: high when ink collapses onto few rows.
    const score = sum > 0 ? sq / sum : 0;
    if (score > best.score) best = { angle, score };
  }

  return Math.abs(best.angle) < step ? 0 : best.angle;
}

/** Rotate an RGBA image (degrees, clockwise) around its centre, white fill. */
export function rotateRgba(img: RgbaImage, degrees: number): RgbaImage {
  if (!degrees) return img;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const o = (y * w + x) * 4;

      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const wx = sx - x0;
      const wy = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;

      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - wx) + data[i10 + c] * wx;
        const bottom = data[i01 + c] * (1 - wx) + data[i11 + c] * wx;
        out[o + c] = top * (1 - wy) + bottom * wy;
      }
      out[o + 3] = 255;
    }
  }

  return { data: out, width: w, height: h };
}
