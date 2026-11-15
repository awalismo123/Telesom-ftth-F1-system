/**
 * Before and after.
 *
 * A proof photo answers "is it fixed?". It cannot answer "was the fault where
 * the technician said it was", which is the question a repeat fault or a
 * disputed charge turns on.
 *
 * ## The rule that had to change
 *
 * Until now the server refused **any** photo unless the job was completed —
 * correct for proof, impossible for a before photo. The rule is now split: an
 * `after` photo still needs a completed job, a `before` photo only needs a job
 * that exists and is not cancelled.
 *
 * ## Optional means optional
 *
 * A technician is never blocked from closing a job because they did not
 * photograph the before. Nothing in the completion path waits for this.
 */

export type PhotoKind = 'before' | 'after';

export const PHOTO_KINDS: readonly PhotoKind[] = ['before', 'after'] as const;

/** How many of each kind a job may hold. The server enforces the same number. */
export const PER_KIND_CAP = 3;

/** Normalise anything the server or an old client sends. */
export function asPhotoKind(value: string | null | undefined): PhotoKind {
  return value === 'before' ? 'before' : 'after';
}

/**
 * Can this job take a before photo?
 *
 * A completed or cancelled job cannot — the "before" moment has passed, and
 * accepting one retroactively would let the record be arranged after the fact.
 */
export function canTakeBefore(status: string): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

/** Room for another photo of this kind? */
export function roomFor(kind: PhotoKind, existing: readonly { kind: string }[]): boolean {
  return existing.filter((photo) => asPhotoKind(photo.kind) === kind).length < PER_KIND_CAP;
}

export function beforeLabel(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'Sawir ka hor shaqada' : 'Before photo';
}

export function afterLabel(lang: 'en' | 'so'): string {
  return lang === 'so' ? 'Sawir kadib shaqada' : 'After photo';
}

export function optionalNote(lang: 'en' | 'so'): string {
  return lang === 'so'
    ? 'Ikhtiyaari — shaqada lama joojinayo haddii aanad sawir qaadin.'
    : 'Optional — you are never blocked from closing the job without one.';
}

/** Why the button is not there, when it is not. */
export function whyNoBefore(status: string, lang: 'en' | 'so'): string | null {
  if (status === 'completed') {
    return lang === 'so'
      ? 'Shaqadu dhammaatay — sawirka "ka hor" hadda lama qaadi karo.'
      : 'The job is finished — a before photo can no longer be taken.';
  }
  if (status === 'cancelled') {
    return lang === 'so' ? 'Shaqadan waa la tirtiray.' : 'This job was cancelled.';
  }
  return null;
}

export const BEFORE_WHY = {
  en: 'A photo on arrival records the state you found. It is not proof of anything you did, and it is not used to score anybody.',
  so: 'Sawirka markaad timaado waxay diiwaangelinaysaa xaaladda aad heshay. Ma aha caddayn waxaad qabatay, lamana isticmaalo in qof lagu qiimeeyo.',
} as const;
