/**
 * Larger-text mode.
 *
 * Why this exists rather than "make everything bigger": the department asked
 * for a UI that works for older staff, and also asked to keep the current
 * density. Those pull against each other. The honest resolution is a setting —
 * the people who need bigger text get it, and the managers keep the density
 * they approved.
 *
 * The scaling itself is done in CSS (`index.css`), because it has to reach two
 * different kinds of size in this codebase:
 *
 *   · the rem-based scale, which follows the root font size
 *   · ~390 px-locked micro-labels (`text-[10px]`, `text-[11px]`), which are
 *     the *smallest* text on the screen and therefore the text that matters
 *     most for someone who cannot read small print
 *
 * Scaling only the root would have grown the body copy and left the labels
 * that people actually struggle with exactly where they were.
 */

export type TextSize = 'normal' | 'large' | 'xlarge';

const STORAGE_KEY = 'ftth.text-size';

/** Ordered smallest to largest; the header button cycles through them. */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ['normal', 'large', 'xlarge'];

export function isTextSize(value: unknown): value is TextSize {
  return value === 'normal' || value === 'large' || value === 'xlarge';
}

/** The stored preference, or `normal` when there is none or it is unreadable. */
export function readTextSize(storage?: Pick<Storage, 'getItem'> | null): TextSize {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return isTextSize(raw) ? raw : 'normal';
  } catch {
    // Private mode, a blocked cookie jar, a quota error — none of them should
    // stop the app from rendering at a normal size.
    return 'normal';
  }
}

export function writeTextSize(
  size: TextSize,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    storage?.setItem(STORAGE_KEY, size);
  } catch {
    // A preference that cannot be saved is not worth failing a render over.
  }
}

/** The next size in the cycle, wrapping back to normal. */
export function nextTextSize(current: TextSize): TextSize {
  const index = TEXT_SIZE_ORDER.indexOf(current);
  return TEXT_SIZE_ORDER[(index + 1) % TEXT_SIZE_ORDER.length];
}

/** Apply to the document root; CSS does the rest. */
export function applyTextSize(
  size: TextSize,
  root?: { setAttribute(name: string, value: string): void } | null,
): void {
  root?.setAttribute('data-text-size', size);
}

export interface TextSizeCopy {
  /** What the button shows next to the "Aa" glyph. */
  short: string;
  /** Full name, for the accessible label and the toast. */
  label: string;
  /** What will happen if the button is pressed. */
  next: string;
}

export function textSizeCopy(size: TextSize, lang: 'so' | 'en'): TextSizeCopy {
  const so = lang === 'so';
  const names: Record<TextSize, { so: string; en: string }> = {
    normal: { so: 'Caadi', en: 'Normal' },
    large: { so: 'Weyn', en: 'Large' },
    xlarge: { so: 'Aad u weyn', en: 'Extra large' },
  };
  const upcoming = nextTextSize(size);
  const upcomingName = so ? names[upcoming].so : names[upcoming].en;

  return {
    short: so ? names[size].so : names[size].en,
    label: so ? `Qoraalka: ${names[size].so}` : `Text size: ${names[size].en}`,
    next: so ? `Beddel: ${upcomingName}` : `Change to ${upcomingName}`,
  };
}
