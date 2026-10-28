/**
 * Field normalisers for Telesom Group F1 sheets.
 *
 * Kept pure + framework-free so they can be unit-tested and reused by the
 * picture pipeline, the Excel/CSV pipeline and the paste pipeline.
 */

import type { ColumnDef, SheetTemplate } from './templates';

const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  i: '1',
  ']': '1',
  '[': '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  B: '8',
  b: '6',
  G: '6',
  g: '9',
  q: '9',
  T: '7',
  J: '7',
  A: '4',
};

/** Repair an OCR'd numeric string (only used in numeric columns). */
export function repairDigits(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (DIGIT_LOOKALIKES[ch]) {
      out += DIGIT_LOOKALIKES[ch];
    }
  }
  return out;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/** Known Fixed Broadband group codes, in the order used by the department. */
export const KNOWN_GROUPS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'GA', 'GB', 'G1', 'G2'];

/** Snap a messy group cell ("FI", "F 1", "FT", "F-1") onto a group code. */
export function normalizeGroupCode(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';

  // Direct / repaired match
  for (const known of KNOWN_GROUPS) {
    if (cleaned === known) return known;
  }

  // Repair typical OCR confusions inside the code ("FI" → "F1")
  const repaired = cleaned
    .split('')
    .map((ch) => {
      if (ch === 'I' || ch === 'L' || ch === '|') return '1';
      if (ch === 'O' || ch === 'Q') return '0';
      return ch;
    })
    .join('');
  for (const known of KNOWN_GROUPS) {
    if (repaired === known) return known;
  }

  // Prefix pass: "F1CILAD" / "F1 " → F1
  const prefix = repaired.match(/^([FG])(\d{1,2})/);
  if (prefix) {
    const candidate = `${prefix[1]}${prefix[2]}`;
    if (KNOWN_GROUPS.includes(candidate)) return candidate;
    if (prefix[1] === 'F') return candidate; // new F-group not yet in the list
  }

  return '';
}

export type DateFormat = 'dmy' | 'mdy';

/**
 * Telesom's sheets are inconsistent: Galinta prints `28-10-2026` (day first)
 * while Cilada prints `10/26/2026` (month first). We vote across the whole
 * batch so ambiguous values (both parts <= 12) are read the same way.
 */
export function pickDateFormat(raws: string[]): DateFormat {
  let dmyVotes = 0;
  let mdyVotes = 0;

  for (const raw of raws) {
    if (!raw) continue;
    const parts = raw.replace(/[^\d/\-. ]/g, ' ').split(/[^\d]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a > 12 && a <= 31) dmyVotes++;
    else if (b > 12 && b <= 31) mdyVotes++;
  }

  return mdyVotes > dmyVotes ? 'mdy' : 'dmy';
}

/** Parse the many date shapes used by the department (d/m/y, d-m-y, y-m-d). */
export function normalizeDate(raw: string, format: DateFormat = 'dmy'): string | null {
  if (!raw) return null;
  const text = raw.replace(/[^\d/\-.\s]/g, ' ').trim();
  if (!text) return null;

  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return buildDate(Number(y), Number(m), Number(d));
  }

  const parts = text.split(/[^\d]+/).filter(Boolean);
  if (parts.length >= 3) {
    const [a, b, c] = parts.map(Number);
    if (String(parts[2]).length === 4) {
      // dd/mm/YYYY or mm/dd/YYYY
      const first = format === 'dmy' ? buildDate(c, b, a) : buildDate(c, a, b);
      if (first) return first;
      // Fall back to the other interpretation if the preferred one is invalid.
      return format === 'dmy' ? buildDate(c, a, b) : buildDate(c, b, a);
    }
    if (a > 31) {
      // Y/m/d with a 2-digit year is unlikely; treat as y/m/d
      return buildDate(a < 100 ? 2000 + a : a, b, c);
    }
    return buildDate(2000 + c, b, a);
  }

  if (parts.length === 2) {
    const [a, b] = parts.map(Number);
    return buildDate(2000 + b, 1, a) ?? null;
  }

  return null;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  let y = year;
  if (y < 100) y += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Normalise a clock value coming from the sheet ("11:15:3", "15:14.2"). */
export function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\s*[:.;]\s*(\d{2})(?:\s*[:.;]\s*(\d{1,2}))?/);
  if (!m) {
    const digits = digitsOnly(raw);
    if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    if (digits.length === 6) {
      return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
    }
    return null;
  }
  const hh = m[1].padStart(2, '0');
  const mm = m[2];
  const ss = m[3] ? m[3].padStart(2, '0') : null;
  return ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

export interface ParsedCablebox {
  boxCode: string | null;
  port: number | null;
  oltPath: string | null;
}

/**
 * Understand the Cablebox column:
 *   "F2 OLt2-1 ODF4-45 SPL1-1 FAT48-1" → box FAT48, port 1, upstream OLT/ODF/SPL
 *   "B6 (52)-4"                        → box "B6 (52)", port 4
 *   "-1 FAT48-1"                       → box FAT48, port 1 (carry-over continuation)
 */
export function parseCablebox(raw: string): ParsedCablebox {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { boxCode: null, port: null, oltPath: null };

  // 1) A FAT box is present — it is always the box serving the customer, and
  //    everything before it is the upstream OLT/ODF/SPL path.
  const fat = text.match(/FAT\s*[-_ ]?\s*([A-Za-z0-9]+)(?:\s*[-–]\s*(\d{1,2}))?/i);
  if (fat) {
    const code = `FAT${fat[1]}`.toUpperCase().replace(/\s+/g, '');
    const port = fat[2] ? Number(fat[2]) : null;
    const upstream = text.replace(fat[0], '').replace(/\s+/g, ' ').trim();
    return { boxCode: code, port, oltPath: upstream || null };
  }

  // 2) Only an upstream path (OLT/ODF/SPL) — the specific box is not named.
  if (/OLT|ODF|SPL/i.test(text)) {
    return { boxCode: null, port: null, oltPath: text };
  }

  // 3) Plain box code with a trailing port: "B6 (52)-4", "CB390-26 (55)-1".
  const trailing = text.match(/^(.*\S)\s*[-–]\s*(\d{1,2})\s*$/);
  if (trailing) {
    const candidate = trailing[1].trim().toUpperCase();
    if (candidate.length >= 2 && /\d/.test(candidate)) {
      return { boxCode: candidate, port: Number(trailing[2]), oltPath: null };
    }
  }

  // 4) Bare code — only accept something that looks like a box (has a digit),
  //    so OCR noise such as "oo" never creates a cablebox record.
  const candidate = text.toUpperCase();
  const looksLikeBox = candidate.length >= 2 && /\d/.test(candidate);
  return { boxCode: looksLikeBox ? candidate : null, port: null, oltPath: null };
}

/** Canonical key for matching a cablebox across imports. */
export function cableboxKey(boxCode: string): string {
  return boxCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const URGENT_PATTERNS = [
  /\bdeg\s*-?\s*deg\b/i,
  /\bdegdeg\b/i,
  /\bdeg\b/i,
  /\bdd\b/i,
  /\bdadaji\b/i,
  /\bdajaji\b/i,
  /\bdadaj[iy]\b/i,
  /\bdeg deg\b/i,
  /\bsoon\b/i,
  /\burgent\b/i,
];

/** "degdeg", "DEG DEG", "dd", "dadaji" → urgent Cilada. */
export function isUrgentComplaint(raw: string): boolean {
  if (!raw) return false;
  return URGENT_PATTERNS.some((re) => re.test(raw));
}

/** Detect "cylinder already collected / yet to collect" in the Galinta XNumber column. */
export function interpretXNumber(raw: string): 'collected' | 'not_collected' | 'unknown' {
  const t = (raw || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return 'unknown';
  if (t.includes('qaat') || t.includes('qatay') || t.includes('qaatay')) return 'collected';
  if (t === 'muu' || t === 'mu' || t.includes('muu') || t.includes('ma qaadan')) return 'not_collected';
  return 'unknown';
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');
}

/** Very small Levenshtein for fuzzy column-header matching. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export interface RowIssue {
  column: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface NormalizedRow {
  values: Record<string, string | number | null>;
  issues: RowIssue[];
  /** Raw text per template column, for the "original text" tooltip. */
  raw: Record<string, string>;
}

const NUMERIC_KINDS = new Set(['id', 'line', 'phone']);

/**
 * Turn raw OCR cell text into the strongly typed record the importer needs.
 */
export function normalizeRow(
  template: SheetTemplate,
  cells: Record<string, string>,
  dateFormat: DateFormat = 'dmy',
): NormalizedRow {
  const values: Record<string, string | number | null> = {};
  const issues: RowIssue[] = [];

  for (const col of template.columns) {
    const raw = (cells[col.key] ?? '').replace(/\s+/g, ' ').trim();
    const value = normalizeValue(col, raw, issues, dateFormat);
    values[col.key] = value;
  }

  return { values, issues, raw: cells };
}

function normalizeValue(
  col: ColumnDef,
  raw: string,
  issues: RowIssue[],
  dateFormat: DateFormat,
): string | number | null {
  if (!raw) return null;

  switch (col.kind) {
    case 'id': {
      const n = Number(repairDigits(raw));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case 'line': {
      const digits = repairDigits(raw);
      if (!digits) {
        issues.push({ column: col.key, message: 'Line number could not be read', severity: 'error' });
        return null;
      }
      if (digits.length !== 6) {
        issues.push({
          column: col.key,
          message: `Line has ${digits.length} digits (expected 6) — please verify`,
          severity: 'warning',
        });
      }
      return digits;
    }
    case 'phone': {
      const digits = repairDigits(raw);
      if (!digits) return null;
      if (digits.length < 6) {
        issues.push({ column: col.key, message: 'Phone number looks too short', severity: 'warning' });
      }
      return digits;
    }
    case 'group': {
      const code = normalizeGroupCode(raw);
      if (!code) {
        issues.push({
          column: col.key,
          message: `Group "${raw}" not recognised`,
          severity: 'warning',
        });
        return raw.toUpperCase();
      }
      return code;
    }
    case 'date': {
      const iso = normalizeDate(raw, dateFormat);
      if (!iso) {
        issues.push({ column: col.key, message: `Date "${raw}" not recognised`, severity: 'warning' });
        return null;
      }
      return iso;
    }
    case 'time':
      return normalizeTime(raw) ?? raw;
    case 'cablebox':
      return raw;
    case 'complain':
      return raw;
    case 'name':
    case 'text':
    case 'code':
    case 'speed':
    default:
      return raw;
  }
}

/** True when a normalised row has no usable identity at all. */
export function isRowEmpty(values: Record<string, unknown>): boolean {
  return !values.line_number && !values.customer_name && !values.customer_phone;
}

export { NUMERIC_KINDS };
