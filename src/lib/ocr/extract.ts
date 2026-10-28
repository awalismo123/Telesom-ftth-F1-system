/**
 * Shared row builder — turns raw cell text (from OCR, CSV, TSV paste or Excel
 * clipboard) into the typed, normalized rows the import wizard works with.
 */

import {
  normalizeRow,
  pickDateFormat,
  isRowEmpty,
  parseCablebox,
  isUrgentComplaint,
  interpretXNumber,
  type RowIssue,
  type DateFormat,
} from './normalize';
import type { SheetTemplate } from './templates';

export interface ExtractedRow {
  /** stable local id for React keys */
  id: string;
  /** raw cell text exactly as read */
  raw: Record<string, string>;
  /** normalized values keyed by template column key */
  values: Record<string, string | number | null>;
  issues: RowIssue[];
  /** derived helpers used by the importer + UI */
  derived: {
    lineNumber: string | null;
    groupCode: string;
    customerName: string;
    phone: string | null;
    xaafada: string | null;
    cableboxCode: string | null;
    cableboxPort: number | null;
    oltPath: string | null;
    urgent: boolean;
    routerState: 'collected' | 'not_collected' | 'unknown';
    reportedDate: string | null;
  };
}

let seq = 0;
function localId(): string {
  seq += 1;
  return `r${Date.now().toString(36)}${seq}`;
}

export function buildRowsFromRecords(
  records: Record<string, string>[],
  template: SheetTemplate,
  dateFormat?: DateFormat,
): ExtractedRow[] {
  const format =
    dateFormat ??
    pickDateFormat(
      records
        .map((r) => r[template.id === 'cilada' ? 'reported_date' : 'reported_date'])
        .filter(Boolean),
    );

  return records.map((record) => {
    const normalized = normalizeRow(template, record, format);
    const v = normalized.values;

    const cableboxRaw = String(v.cablebox_code_raw ?? '');
    const parsedBox = parseCablebox(cableboxRaw);
    const complain = String(v.complain_type ?? '');
    const lineNumber = v.line_number ? String(v.line_number) : null;

    const issues = [...normalized.issues];
    if (!lineNumber) {
      issues.push({
        column: 'line_number',
        message: 'Missing line number — this row will be skipped',
        severity: 'error',
      });
    }

    return {
      id: localId(),
      raw: normalized.raw,
      values: v,
      issues,
      derived: {
        lineNumber,
        groupCode: String(v.group_code ?? '').toUpperCase(),
        customerName: String(v.customer_name ?? '').trim(),
        phone: v.customer_phone ? String(v.customer_phone) : null,
        xaafada: v.xaafada ? String(v.xaafada).trim() : null,
        cableboxCode: parsedBox.boxCode,
        cableboxPort: parsedBox.port,
        oltPath: parsedBox.oltPath,
        urgent: isUrgentComplaint(complain),
        routerState: interpretXNumber(String(v.x_number ?? '')),
        reportedDate: v.reported_date ? String(v.reported_date) : null,
      },
    };
  });
}

/** Rebuild a single row after a manual cell edit in the review table. */
export function updateRowCell(
  row: ExtractedRow,
  template: SheetTemplate,
  columnKey: string,
  value: string,
  dateFormat?: DateFormat,
): ExtractedRow {
  const raw = { ...row.raw, [columnKey]: value };
  const rebuilt = buildRowsFromRecords([raw], template, dateFormat)[0];
  return { ...rebuilt, id: row.id };
}

export function isBlankRow(row: ExtractedRow): boolean {
  return isRowEmpty(row.values);
}
