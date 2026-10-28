/**
 * Table templates for Telesom Fixed Broadband daily reports.
 *
 * Both header layouts were taken from the real pictures the department posts
 * in the group chat every morning.
 */

export type ColumnKind = 'id' | 'text' | 'name' | 'line' | 'phone' | 'group' | 'time' | 'date' | 'speed' | 'cablebox' | 'complain' | 'code';

export interface ColumnDef {
  key: string;
  /** Header labels seen in real sheets (lower-cased, punctuation stripped). */
  aliases: string[];
  kind: ColumnKind;
  /** Tesseract char whitelist for this column. */
  whitelist?: string;
  labelEn: string;
  labelSo: string;
  width?: number;
}

export interface SheetTemplate {
  id: 'galinta' | 'cilada';
  nameEn: string;
  nameSo: string;
  subtitle: string;
  columns: ColumnDef[];
}

export const GALINTA_TEMPLATE: SheetTemplate = {
  id: 'galinta',
  nameEn: 'Pending Installation',
  nameSo: 'Galinta (Rakibaad Taagan)',
  subtitle: 'Fixed Broadband Department — Pending Installation',
  columns: [
    { key: 'sheet_row_id', aliases: ['id', 'no', 'n'], kind: 'id', whitelist: '0123456789', labelEn: 'ID', labelSo: 'ID', width: 48 },
    { key: 'customer_name', aliases: ['custname', 'customer name', 'customer', 'cust', 'magaca', 'name'], kind: 'name', labelEn: 'CustName', labelSo: 'Macmiilka', width: 150 },
    { key: 'line_number', aliases: ['line no', 'lineno', 'line', 'line_no', 'linenumber'], kind: 'line', whitelist: '0123456789', labelEn: 'Line_No', labelSo: 'Lambarka Line', width: 80 },
    { key: 'x_number', aliases: ['xnumber', 'x number', 'xno', 'x-number'], kind: 'code', labelEn: 'XNumber', labelSo: 'XNumber', width: 80 },
    { key: 'customer_phone', aliases: ['ref-number', 'refnumber', 'ref number', 'ref', 'phone', 'tell'], kind: 'phone', whitelist: '0123456789', labelEn: 'Ref-Number', labelSo: 'Taleefanka', width: 95 },
    { key: 'xaafada', aliases: ['xaafada', 'xaafad', 'area', 'neighborhood', 'district'], kind: 'text', labelEn: 'Xaafada', labelSo: 'Xaafada', width: 105 },
    { key: 'service_type', aliases: ['service', 'adeeg'], kind: 'text', labelEn: 'Service', labelSo: 'Adeegga', width: 65 },
    { key: 'work_subtype', aliases: ['shaqada', 'work', 'job'], kind: 'text', labelEn: 'Shaqada', labelSo: 'Shaqada', width: 105 },
    { key: 'reported_date', aliases: ['datein', 'date in', 'date', 'taariikh'], kind: 'date', labelEn: 'DateIn', labelSo: 'Taariikhda', width: 85 },
    { key: 'reported_time', aliases: ['timein', 'time in', 'time'], kind: 'time', labelEn: 'TimeIn', labelSo: 'Waqtiga', width: 75 },
    { key: 'speed_plan', aliases: ['speed', 'xawaaraha', 'package'], kind: 'speed', labelEn: 'Speed', labelSo: 'Xawaaraha', width: 65 },
    { key: 'group_code', aliases: ['group', 'kooxda', 'group name'], kind: 'group', labelEn: 'Group', labelSo: 'Kooxda', width: 55 },
  ],
};

export const CILADA_TEMPLATE: SheetTemplate = {
  id: 'cilada',
  nameEn: 'Active Faults',
  nameSo: 'Cilada (Ciladaha Taagan)',
  subtitle: 'Fixed Broadband Department — CILADA KU TAAGAN GROUP-KA',
  columns: [
    { key: 'sheet_row_id', aliases: ['id', 'no'], kind: 'id', whitelist: '0123456789', labelEn: 'ID', labelSo: 'ID', width: 45 },
    { key: 'customer_name', aliases: ['customer name', 'customername', 'customer', 'name', 'magaca'], kind: 'name', labelEn: 'Customer Name', labelSo: 'Macmiilka', width: 170 },
    { key: 'customer_phone', aliases: ['refnumber', 'ref number', 'ref-number', 'ref', 'phone'], kind: 'phone', whitelist: '0123456789', labelEn: 'RefNumber', labelSo: 'Taleefanka', width: 95 },
    { key: 'disc_code', aliases: ['disc', 'dis', 'disc code'], kind: 'code', labelEn: 'DISC', labelSo: 'DISC', width: 45 },
    { key: 'line_number', aliases: ['line', 'line no', 'linenumber'], kind: 'line', whitelist: '0123456789', labelEn: 'Line', labelSo: 'Lambarka Line', width: 75 },
    { key: 'cablebox_code_raw', aliases: ['cablebox', 'cable box', 'box', 'fat'], kind: 'cablebox', labelEn: 'Cablebox', labelSo: 'Cablebox', width: 165 },
    { key: 'service_type', aliases: ['type', 'nooca'], kind: 'text', labelEn: 'Type', labelSo: 'Nooca', width: 60 },
    { key: 'group_code', aliases: ['group', 'kooxda'], kind: 'group', labelEn: 'Group', labelSo: 'Kooxda', width: 55 },
    { key: 'reported_time', aliases: ['time', 'waqtiga'], kind: 'time', labelEn: 'Time', labelSo: 'Waqtiga', width: 75 },
    { key: 'reported_date', aliases: ['date in', 'datein', 'date', 'taariikh'], kind: 'date', labelEn: 'Date In', labelSo: 'Taariikhda', width: 85 },
    { key: 'date_out', aliases: ['date out', 'dateout'], kind: 'date', labelEn: 'Date Out', labelSo: 'Date Out', width: 75 },
    { key: 'time_out', aliases: ['timeout', 'time out'], kind: 'time', labelEn: 'TimeOut', labelSo: 'TimeOut', width: 70 },
    { key: 'complain_type', aliases: ['complain-type', 'complain type', 'complaint', 'complain', 'cilada', 'issue'], kind: 'complain', labelEn: 'Complain-type', labelSo: 'Nooca Cilada', width: 100 },
  ],
};

export const TEMPLATES: SheetTemplate[] = [GALINTA_TEMPLATE, CILADA_TEMPLATE];

export function getTemplate(id: 'galinta' | 'cilada'): SheetTemplate {
  return id === 'galinta' ? GALINTA_TEMPLATE : CILADA_TEMPLATE;
}

/** Strip punctuation/spacing so header cells can be matched against aliases. */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, used to survive OCR typos in header cells. */
function editDistance(a: string, b: string): number {
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
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[n];
}

/**
 * Fuzzy header comparison. Real-world header cells come back as "Shagada",
 * "Refiumber", "Datelin", "Complaim-typs"… so a 1–2 character edit distance
 * must still match.
 */
export function headerSimilarity(cell: string, alias: string): number {
  const a = normalizeHeader(cell).replace(/\s+/g, '');
  const b = normalizeHeader(alias).replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  if (a.includes(b) || b.includes(a)) return 0.8;

  const distance = editDistance(a, b);
  const longest = Math.max(a.length, b.length);
  const tolerance = longest <= 5 ? 1 : longest <= 9 ? 2 : 3;
  if (distance <= tolerance) return 0.7 - distance * 0.1;

  // A short alias can sit inside a longer OCR'd header with noise around it.
  if (b.length >= 4 && editDistance(a.slice(0, b.length), b) <= 1) return 0.5;

  return 0;
}

export interface HeaderMatch {
  /** template column index → detected column index (-1 when unmatched) */
  mapping: number[];
  /** confidence 0..1 */
  score: number;
}

/** Assign template column index → detected template column (or -1). */
export function matchHeaderRow(cells: string[], template: SheetTemplate): number[] {
  return matchHeaderRowScored(cells, template).mapping;
}

export function matchHeaderRowScored(cells: string[], template: SheetTemplate): HeaderMatch {
  const used = new Set<number>();
  const mapping = template.columns.map(() => -1);

  // Two passes so high-confidence columns claim their index first and a noisy
  // neighbour cannot steal it.
  const candidates: { colIdx: number; cellIdx: number; score: number }[] = [];

  template.columns.forEach((col, colIdx) => {
    cells.forEach((cell, cellIdx) => {
      if (!cell || !cell.trim()) return;
      let best = 0;
      for (const alias of col.aliases) {
        best = Math.max(best, headerSimilarity(cell, alias));
      }
      if (best >= 0.35) candidates.push({ colIdx, cellIdx, score: best });
    });
  });

  candidates.sort((a, b) => b.score - a.score);

  for (const cand of candidates) {
    if (mapping[cand.colIdx] >= 0) continue;
    if (used.has(cand.cellIdx)) continue;
    if (cand.score < 0.4) continue;
    mapping[cand.colIdx] = cand.cellIdx;
    used.add(cand.cellIdx);
  }

  const matched = mapping.filter((m) => m >= 0).length;
  return { mapping, score: matched / template.columns.length };
}

/** How well a header row matches a template (0..1). */
export function scoreTemplate(cells: string[], template: SheetTemplate): number {
  return matchHeaderRowScored(cells, template).score;
}

/** Best-guess sheet type from a set of header cells. */
export function detectTemplateFromHeaders(cells: string[]): {
  template: SheetTemplate;
  score: number;
} {
  const scored = TEMPLATES.map((tpl) => ({ template: tpl, score: scoreTemplate(cells, tpl) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

/** Same, but from the raw OCR text of a whole picture (title keywords). */
export function detectTemplateFromTitle(text: string): SheetTemplate | null {
  const t = text.toLowerCase();
  if (t.includes('pending installation') || t.includes('galinta')) return GALINTA_TEMPLATE;
  if (t.includes('cilada') || t.includes('cilad')) return CILADA_TEMPLATE;
  return null;
}
