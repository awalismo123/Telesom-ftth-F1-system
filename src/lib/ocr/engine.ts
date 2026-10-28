/**
 * Browser OCR engine — everything runs on-device. No picture ever leaves the
 * supervisor's phone or laptop.
 */

import { createWorker, type Worker } from 'tesseract.js';
import {
  toGray,
  otsuThreshold,
  binarize,
  detectGrid,
  removeRules,
  maskToRgba,
  resizeRgba,
  type GridModel,
  type RgbaImage,
} from './imageOps';
import { assembleTable, type OcrWord, type AssembledTable } from './assemble';
import type { SheetTemplate } from './templates';

export interface OcrProgress {
  stage: 'preparing' | 'reading' | 'assembling' | 'done';
  /** 0..1 */
  progress: number;
  message: string;
}

export interface OcrResult {
  table: AssembledTable;
  grid: GridModel;
  titleText: string;
  wordCount: number;
  /** Data URL of the pre-processed image, for the side-by-side preview. */
  processedPreview: string;
  /** Table bounds in *processed* image pixels (for the overlay). */
  tableBounds: { left: number; top: number; right: number; bottom: number };
  imageSize: { width: number; height: number };
  elapsedMs: number;
}

const MAX_WIDTH = 2200;

let workerPromise: Promise<Worker> | null = null;
let workerProgress: ((p: number) => void) | null = null;

async function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  workerProgress = onProgress ?? workerProgress;

  const base = import.meta.env.BASE_URL || '/';
  const asset = (p: string) => `${base.replace(/\/$/, '')}/tesseract/${p}`;

  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: asset('worker.min.js'),
      corePath: asset('core'),
      langPath: asset('lang'),
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && workerProgress) {
          workerProgress(m.progress);
        }
      },
    }).then(async (worker) => {
      await worker.setParameters({
        // Uniform block of text: the right layout assumption for a ruled table.
        tessedit_pageseg_mode: '6' as never,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      return worker;
    });
  }

  return workerPromise;
}

async function fileToBitmap(file: File | Blob): Promise<{ width: number; height: number; draw: (canvas: HTMLCanvasElement) => void }> {
  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw: (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D is not available in this browser');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    },
  };
}

function imageDataToRgba(data: ImageData): RgbaImage {
  return { data: data.data, width: data.width, height: data.height };
}

function parseTsvWords(tsv: string): OcrWord[] {
  const words: OcrWord[] = [];
  for (const line of tsv.split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols.slice(11).join(' ').trim();
    if (!text) continue;
    const conf = Number(cols[10]);
    if (Number.isFinite(conf) && conf < 30) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    words.push({ text, x0: left, y0: top, x1: left + width, y1: top + height, conf });
  }
  return words;
}

/**
 * Full picture → structured table pipeline.
 */
export async function extractFromImage(
  file: File | Blob,
  onProgress?: (p: OcrProgress) => void,
  templateHint?: SheetTemplate,
): Promise<OcrResult> {
  const started = performance.now();
  onProgress?.({ stage: 'preparing', progress: 0.02, message: 'Reading the picture…' });

  const bitmap = await fileToBitmap(file);
  let scale = MAX_WIDTH / bitmap.width;
  if (scale > 2.2) scale = 2.2;
  if (scale < 0.35) scale = 0.35;

  const width = Math.max(50, Math.round(bitmap.width * scale));
  const height = Math.max(50, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  bitmap.draw(canvas);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  const sourceData = ctx.getImageData(0, 0, width, height);

  let rgba = imageDataToRgba(sourceData);
  if (scale > 1) rgba = resizeRgba(rgba, 1); // already drawn at target size

  onProgress?.({ stage: 'preparing', progress: 0.1, message: 'Detecting the table grid…' });

  const gray = toGray(rgba);
  const threshold = otsuThreshold(gray);
  const mask = binarize(gray, threshold);
  const grid = detectGrid(mask);

  onProgress?.({ stage: 'preparing', progress: 0.18, message: 'Removing grid lines…' });

  const cleaned = removeRules(mask, grid, 2);
  const cleanedRgba = maskToRgba(cleaned);

  // Draw the cleaned image back to the canvas for Tesseract + preview.
  const cleanedImageData = new ImageData(
    new Uint8ClampedArray(cleanedRgba.data),
    cleanedRgba.width,
    cleanedRgba.height,
  );
  ctx.putImageData(cleanedImageData, 0, 0);
  const processedPreview = canvas.toDataURL('image/jpeg', 0.85);

  onProgress?.({ stage: 'reading', progress: 0.22, message: 'Reading the text (first run downloads the model)…' });

  const worker = await getWorker((p) => {
    onProgress?.({
      stage: 'reading',
      progress: 0.22 + p * 0.7,
      message: `Reading the text… ${Math.round(p * 100)}%`,
    });
  });

  const { data } = await worker.recognize(canvas, {}, { tsv: true });
  const words = parseTsvWords(typeof data.tsv === 'string' ? data.tsv : '');

  onProgress?.({ stage: 'assembling', progress: 0.95, message: 'Sorting cells into columns…' });

  const table = assembleTable(words, grid, templateHint);

  onProgress?.({ stage: 'done', progress: 1, message: 'Done' });

  return {
    table,
    grid,
    titleText: (data.text || '').split('\n').slice(0, 4).join(' ').trim(),
    wordCount: words.length,
    processedPreview,
    tableBounds: grid.table,
    imageSize: { width: cleaned.width, height: cleaned.height },
    elapsedMs: Math.round(performance.now() - started),
  };
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
