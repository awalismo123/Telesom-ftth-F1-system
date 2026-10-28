/**
 * Browser adapter for the OCR pipeline.
 *
 * Decodes the uploaded picture, scales it to a sensible width and hands every
 * crop to a single Tesseract worker. All of the actual table logic lives in
 * `pipeline.ts` so it can be tested outside the browser.
 */

import { createWorker, type Worker } from 'tesseract.js';
import type { RgbaImage } from './imageOps';
import { runPipeline, type OcrRuntime, type PipelineOptions, type PipelineResult } from './pipeline';
import type { OcrWord } from './assemble';

export type { OcrProgress, OcrStats, ColumnFill, PipelineResult } from './pipeline';
export type OcrResult = PipelineResult & {
  processedPreview: string;
  imageSize: { width: number; height: number };
  tableBounds: { left: number; top: number; right: number; bottom: number };
  wordCount: number;
  elapsedMs: number;
};

const MAX_WIDTH = 2200;

let workerPromise: Promise<Worker> | null = null;

async function setParams(worker: Worker, psm: string, whitelist?: string): Promise<void> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm as never,
    tessedit_char_whitelist: (whitelist ?? '') as never,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
}

function parseTsvWords(tsv: string, minConf: number): OcrWord[] {
  const words: OcrWord[] = [];
  for (const line of tsv.split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols.slice(11).join(' ').trim();
    if (!text) continue;
    const conf = Number(cols[10]);
    if (Number.isFinite(conf) && conf < minConf) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    words.push({ text, x0: left, y0: top, x1: left + width, y1: top + height, conf });
  }
  return words;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

function ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  return ctx;
}

function drawRgba(canvas: HTMLCanvasElement, img: RgbaImage): void {
  const ctx = ctxOf(canvas);
  canvas.width = img.width;
  canvas.height = img.height;
  const data = new Uint8ClampedArray(img.data.length);
  data.set(img.data as unknown as ArrayLike<number>);
  ctx.putImageData(new ImageData(data, img.width, img.height), 0, 0);
}

async function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  const base = import.meta.env.BASE_URL || '/';
  const asset = (p: string) => `${base.replace(/\/$/, '')}/tesseract/${p}`;

  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: asset('worker.min.js'),
      corePath: asset('core'),
      langPath: asset('lang'),
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      },
    });
  }

  return workerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

export async function extractFromImage(
  file: File | Blob,
  onProgress?: PipelineOptions['onProgress'],
  templateHint?: PipelineOptions['templateHint'],
  options?: Omit<PipelineOptions, 'onProgress' | 'templateHint'>,
): Promise<OcrResult> {
  const started = performance.now();

  const bitmap = await createImageBitmap(file);
  let scale = MAX_WIDTH / bitmap.width;
  if (scale > 2.2) scale = 2.2;
  if (scale < 0.35) scale = 0.35;

  const width = Math.max(60, Math.round(bitmap.width * scale));
  const height = Math.max(60, Math.round(bitmap.height * scale));

  const canvas = makeCanvas(width, height);
  const ctx = ctxOf(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);

  const baseImage: RgbaImage = {
    data: ctx.getImageData(0, 0, width, height).data,
    width,
    height,
  };

  const worker = await getWorker((p) => {
    onProgress?.({
      stage: 'reading',
      progress: 0.16 + p * 0.3,
      message: `Reading the table… ${Math.round(p * 100)}%`,
    });
  });

  const workCanvas = makeCanvas(width, height);

  const runtime: OcrRuntime = {
    async recognize(img, opts) {
      drawRgba(workCanvas, img);
      await setParams(worker, opts.psm, opts.whitelist);
      const res = await worker.recognize(workCanvas, {}, { tsv: true });
      const tsv = typeof res.data.tsv === 'string' ? res.data.tsv : '';
      return {
        text: res.data.text || '',
        words: parseTsvWords(tsv, opts.minConf ?? 25),
        conf: Number(res.data.confidence ?? 0),
      };
    },
  };

  const panelWidth = Math.max(80, width);
  const previewCanvas = makeCanvas(panelWidth, height);

  const result = await runPipeline(runtime, baseImage, {
    templateHint,
    onProgress,
    ...options,
  });

  drawRgba(previewCanvas, result.cleaned);
  const processedPreview = previewCanvas.toDataURL('image/jpeg', 0.85);

  return {
    ...result,
    processedPreview,
    imageSize: { width: result.cleaned.width, height: result.cleaned.height },
    tableBounds: result.grid.table,
    wordCount: result.stats.words,
    elapsedMs: Math.round(performance.now() - started),
  };
}
