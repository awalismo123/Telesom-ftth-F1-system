/**
 * Photographic proof, prepared on the phone.
 *
 * A modern phone camera produces 3–8 MB per shot. The database is 500 MB on the
 * Free plan and photographs are the only thing in it that grows without limit,
 * so the picture is resized and re-encoded **before** it leaves the device:
 * 640 px on the long edge, JPEG at quality 0.6 — around 40–120 kB, which is
 * enough to see a connector, a port number and a wall.
 *
 * The fitting maths is pure and tested; only `preparePhoto` touches the DOM.
 */

export const PHOTO_MIME = 'image/jpeg';
export const MAX_PHOTO_EDGE = 640;
export const PHOTO_QUALITY = 0.6;
/** Mirrors the 2 MB backstop in `add_task_photo`. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Scale a picture down so its longest edge is `max`, never up.
 *
 * Upscaling a 200 px photo to 640 px would cost bytes and add no detail, so a
 * small picture is left exactly as it is.
 */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_EDGE): Dimensions {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);

  if (longest <= max) return { width: w, height: h };

  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** `84 kB` / `1.2 MB` — how much this photo will add to the database. */
export function photoSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Base64 length → decoded byte count, without decoding. */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

export interface PreparedPhoto {
  /** Data URL for the preview (never uploaded). */
  preview: string;
  /** Base64 JPEG body, no `data:` prefix — what the RPC expects. */
  base64: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Read a file from the camera, downscale it, and return what the database wants.
 * Throws a plain `Error` with a sentence a technician can act on.
 */
export async function preparePhoto(file: Blob, max = MAX_PHOTO_EDGE): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not a photo');
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation, so a portrait shot is not uploaded
    // lying on its side — the same reason a paper sheet reads sideways otherwise.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('The photo could not be read on this device');
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The photo could not be prepared on this device');

    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL(PHOTO_MIME, PHOTO_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = base64Bytes(base64);

    if (bytes > MAX_PHOTO_BYTES) {
      throw new Error('The photo is still too large after resizing');
    }

    return { preview: dataUrl, base64, mime: PHOTO_MIME, width, height, bytes };
  } finally {
    bitmap.close();
  }
}
