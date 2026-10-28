/**
 * Clipboard / CSV / TSV ingestion.
 *
 * Supervisors usually copy the table straight out of Excel or the group chat,
 * so pasting must work without any file handling.
 */

import {
  detectTemplateFromHeaders,
  matchHeaderRowScored,
  type SheetTemplate,
} from './templates';

export interface ParsedTextTable {
  template: SheetTemplate;
  headerCells: string[];
  records: Record<string, string>[];
  delimiter: string;
  headerScore: number;
  warnings: string[];
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 8).join('\n');
  const candidates: { d: string; count: number }[] = [
    { d: '\t', count: (sample.match(/\t/g) || []).length },
    { d: '|', count: (sample.match(/\|/g) || []).length },
    { d: ';', count: (sample.match(/;/g) || []).length },
    { d: ',', count: (sample.match(/,/g) || []).length },
  ];
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0].count > 0 ? candidates[0].d : '\t';
}

/** Split one line honouring "quoted, cells" (CSV style). */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter !== ',') return line.split(delimiter);

  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function parseTabularText(
  text: string,
  templateHint?: SheetTemplate,
): ParsedTextTable {
  const warnings: string[] = [];
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (!lines.length) {
    throw new Error('Nothing to import — the pasted text is empty.');
  }

  const delimiter = detectDelimiter(lines);
  const rows = lines.map((line) => splitLine(line, delimiter).map((c) => c.trim().replace(/^"|"$/g, '')));

  // Find the header row inside the first few lines.
  let headerIndex = -1;
  let bestScore = 0;
  let template = templateHint;

  rows.slice(0, 5).forEach((cells, idx) => {
    const detected = templateHint
      ? { template: templateHint, score: matchHeaderRowScored(cells, templateHint).score }
      : detectTemplateFromHeaders(cells);
    if (detected.score > bestScore) {
      bestScore = detected.score;
      headerIndex = idx;
      template = detected.template;
    }
  });

  if (!template) {
    throw new Error(
      'Could not recognise the sheet type. Paste the header row (ID, Customer Name, Line, Cablebox…) or pick the sheet type manually.',
    );
  }

  if (headerIndex < 0) {
    warnings.push(
      'Header row not recognised — columns are assumed to be in the standard order.',
    );
  }

  const headerCells = headerIndex >= 0 ? rows[headerIndex] : [];
  const mapping =
    headerIndex >= 0 && headerCells.length
      ? matchHeaderRowScored(headerCells, template).mapping
      : template.columns.map((_, i) => i);

  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  const records: Record<string, string>[] = [];

  for (const cells of dataRows) {
    if (!cells.some((c) => c.length > 0)) continue;
    const record: Record<string, string> = {};
    template.columns.forEach((col, colIdx) => {
      const detectedIdx = mapping[colIdx];
      record[col.key] = detectedIdx >= 0 ? (cells[detectedIdx] ?? '') : '';
    });
    if (!record.line_number && !record.customer_name) continue;
    records.push(record);
  }

  return {
    template,
    headerCells,
    records,
    delimiter,
    headerScore: bestScore,
    warnings,
  };
}

/** Parse a CSV/XLSX-exported file's text content. */
export function parseCsvFile(text: string, templateHint?: SheetTemplate): ParsedTextTable {
  return parseTabularText(text, templateHint);
}
