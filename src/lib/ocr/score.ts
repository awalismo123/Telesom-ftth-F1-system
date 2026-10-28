/**
 * Domain-aware scoring of competing OCR readings of the same cell.
 *
 * Every cell is usually read 2–3 times (whole table, column strip, single cell
 * repair). Instead of "keep whichever string is longer" — which happily keeps a
 * border stub like `1633277158` over the correct `633277158` — each reading is
 * scored against what that column is *allowed* to contain, and the best wins.
 * The winning reading is also cleaned, so callers receive usable data.
 */

import { KNOWN_GROUPS } from './normalize';
import type { ColumnKind } from './templates';

export interface ScoredText {
  text: string;
  score: number;
}

const LEADING_JUNK = /^[\s|\[{(<:'"~`!.,;=_+\-]+/;
const TRAILING_JUNK = /[\s|\[\]{(<>:'"~`!.,;=_+\-]+$/;

export function cleanName(raw: string): string {
  let value = raw.replace(/\s+/g, ' ').trim();
  value = value.replace(LEADING_JUNK, '').replace(TRAILING_JUNK, '');
  // OCR often glues the "#" of "#DR.SALEEBAAN" or splits a word awkwardly.
  value = value.replace(/\s+([.,'’])/g, '$1');
  return value.trim();
}

function digitCount(value: string): number {
  return (value.match(/\d/g) || []).length;
}

function letterCount(value: string): number {
  return (value.match(/[A-Za-z]/g) || []).length;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Local numbers are 9 digits and start with 6. A very common OCR artifact is a
 * faint vertical rule being read as a leading `1`, giving 10 digits.
 */
export function cleanPhone(raw: string): string {
  let value = raw.replace(/\s+/g, '').replace(/[^\d]/g, '');
  if (value.length === 10 && value.startsWith('1')) value = value.slice(1);
  if (value.length === 11 && value.startsWith('01')) value = value.slice(1);
  if (value.length === 12 && value.startsWith('252')) value = value.slice(3);
  return value;
}

export function cleanLine(raw: string): string {
  const value = onlyDigits(raw);
  if (value.length === 7 && value.startsWith('1')) return value.slice(1);
  return value;
}

export function cleanGroup(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const repaired = upper
    .replace(/[IL|]/g, '1')
    .replace(/[OQ]/g, '0')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
  const direct = KNOWN_GROUPS.find((g) => g === repaired) ?? KNOWN_GROUPS.find((g) => g === upper);
  if (direct) return direct;
  const match = repaired.match(/^([FG])(\d{1,2})/);
  if (match) return `${match[1]}${match[2]}`;
  return upper.length <= 3 ? upper : '';
}

export function cleanTime(raw: string): string {
  const match = raw.match(/(\d{1,2})\s*[:.;]\s*(\d{2})(?:\s*[:.;]\s*(\d{1,2}))?/);
  if (!match) return raw.trim();
  const hh = match[1].padStart(2, '0');
  const mm = match[2];
  const ss = match[3] ? match[3].padStart(2, '0') : null;
  return ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

export function cleanDate(raw: string): string {
  const match = raw.match(/(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,4})/);
  if (!match) return raw.trim();
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Score + clean one reading of a cell.
 * Higher is better; 0 means "this column can never contain that".
 */
export function scoreText(kind: ColumnKind | undefined, raw: string): ScoredText {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', score: 0 };

  switch (kind) {
    case 'line': {
      const value = cleanLine(text);
      const digits = digitCount(text);
      const junk = text.length - digits;
      if (value.length === 6) return { text: value, score: 100 - junk * 4 };
      if (value.length === 5 || value.length === 7) return { text: value, score: 55 - junk * 4 };
      return { text: value, score: Math.max(5, 30 - junk * 6) };
    }
    case 'phone': {
      const value = cleanPhone(text);
      const digits = digitCount(text);
      const junk = text.length - digits;
      if (value.length === 9 && value.startsWith('6')) return { text: value, score: 100 - junk * 3 };
      if (value.length === 8 || value.length === 10) return { text: value, score: 55 - junk * 3 };
      if (value.length === 7) return { text: value, score: 40 - junk * 3 };
      return { text: value, score: Math.max(4, 25 - junk * 5) };
    }
    case 'id': {
      const value = onlyDigits(text);
      if (!value) return { text: '', score: 0 };
      if (value.length <= 3) return { text: value, score: 90 - (text.length - value.length) * 3 };
      return { text: value, score: 30 };
    }
    case 'group': {
      const value = cleanGroup(text);
      if (!value) return { text: '', score: 0 };
      if (KNOWN_GROUPS.includes(value)) return { text: value, score: 100 };
      if (/^[FG]\d{1,2}$/.test(value)) return { text: value, score: 60 };
      return { text: value, score: 10 };
    }
    case 'date': {
      const value = cleanDate(text);
      const valid = /^\d{1,4}-\d{1,2}-\d{1,4}$/.test(value);
      return { text: value, score: valid ? 100 : 10 };
    }
    case 'time': {
      const value = cleanTime(text);
      const valid = /^\d{2}:\d{2}(:\d{2})?$/.test(value);
      return { text: value, score: valid ? 100 : 15 };
    }
    case 'cablebox': {
      const letters = letterCount(text);
      const score = Math.min(100, 20 + letters * 6 + (/\d/.test(text) ? 20 : 0));
      return { text, score };
    }
    case 'complain': {
      const letters = letterCount(text);
      const score = Math.min(100, 15 + letters * 5);
      return { text, score };
    }
    case 'speed': {
      const hasSpeed = /\d/.test(text) || /tlite|nor|mb|mega/i.test(text);
      return { text, score: hasSpeed ? 80 : 20 };
    }
    case 'name': {
      const letters = letterCount(text);
      const junk = text.length - letters;
      const ratio = letters / Math.max(1, text.length);
      const score = Math.round(40 + letters * 2.5 + ratio * 40 - junk * 5);
      return { text: cleanName(text), score: Math.max(5, Math.min(120, score)) };
    }
    default: {
      const letters = letterCount(text);
      const score = Math.min(100, 20 + letters * 5);
      return { text, score };
    }
  }
}

/**
 * Minimum score for a reading to be trusted. Below this the cell is left empty
 * (and highlighted for the supervisor) instead of being filled with garbage —
 * a blank phone number is far less harmful than a wrong one.
 */
export function acceptThreshold(kind: ColumnKind | undefined): number {
  switch (kind) {
    case 'phone':
      return 45;
    case 'line':
      return 55;
    case 'group':
      return 55;
    case 'date':
      return 60;
    case 'time':
      return 60;
    case 'id':
      return 35;
    default:
      return 12;
  }
}

export function sanitizeCell(kind: ColumnKind | undefined, raw: string): string {
  const scored = scoreText(kind, raw);
  if (!scored.text) return '';
  return scored.score >= acceptThreshold(kind) ? scored.text : '';
}

/** Validity ratio for a column (used to detect a mis-aligned mapping). */
export function looksValid(kind: ColumnKind | undefined, raw: string): boolean {
  const text = (raw ?? '').trim();
  if (!text) return false;
  switch (kind) {
    case 'line':
      return /^\d{6}$/.test(cleanLine(text));
    case 'phone':
      return /^6\d{8}$/.test(cleanPhone(text));
    case 'group':
      return KNOWN_GROUPS.includes(cleanGroup(text));
    case 'date':
      return /^\d{2,4}-\d{1,2}-\d{2,4}$/.test(cleanDate(text));
    case 'time':
      return /^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime(text));
    case 'id':
      return /^\d{1,3}$/.test(onlyDigits(text));
    case 'cablebox':
      return /FAT|OLT|ODF|SPL|\d/i.test(text);
    default:
      return letterCount(text) >= 2;
  }
}

export function columnWeight(kind: ColumnKind | undefined): number {
  switch (kind) {
    case 'line':
      return 3;
    case 'phone':
      return 3;
    case 'group':
      return 2;
    case 'id':
      return 2;
    case 'date':
    case 'time':
      return 1;
    default:
      return 0;
  }
}

/** Pick the better of two readings, using the domain score. */
export function chooseBetter(kind: ColumnKind | undefined, a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const sa = scoreText(kind, a);
  const sb = scoreText(kind, b);
  if (sb.score > sa.score + 5) return sb.text || b;
  if (sa.score > sb.score + 5) return sa.text || a;
  // Similar quality: keep the cleaner, longer value.
  const cleanA = sa.text;
  const cleanB = sb.text;
  return cleanB.length > cleanA.length ? cleanB : cleanA;
}

export type { ColumnKind };
