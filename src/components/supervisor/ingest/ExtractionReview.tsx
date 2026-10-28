import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Pencil,
  ScanLine,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { ExtractedRow } from '../../../lib/ocr/extract';
import { updateRowCell } from '../../../lib/ocr/extract';
import type { SheetTemplate } from '../../../lib/ocr/templates';
import { useLanguage } from '../../../lib/i18n';

interface Props {
  template: SheetTemplate;
  rows: ExtractedRow[];
  onChange: (rows: ExtractedRow[]) => void;
  preview?: string | null;
  imageSize?: { width: number; height: number } | null;
  gridLines?: { rows: number[]; cols: number[] } | null;
  groupCode: string;
  titleText?: string;
  warnings?: string[];
}

export function ExtractionReview({
  template,
  rows,
  onChange,
  preview,
  imageSize,
  gridLines,
  groupCode,
  titleText,
  warnings,
}: Props) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [showPreview, setShowPreview] = useState(Boolean(preview));
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: string } | null>(null);

  const f1Rows = useMemo(
    () => rows.filter((r) => !r.derived.groupCode || r.derived.groupCode === groupCode),
    [rows, groupCode],
  );
  const otherRows = useMemo(
    () => rows.filter((r) => r.derived.groupCode && r.derived.groupCode !== groupCode),
    [rows, groupCode],
  );
  const visibleRows = showAllGroups ? rows : f1Rows;

  const withIssues = f1Rows.filter((r) => r.issues.length > 0).length;
  const urgentCount = f1Rows.filter((r) => r.derived.urgent).length;

  const colLabel = (labelEn: string, labelSo: string) => (so ? labelSo : labelEn);

  const handleEdit = (rowId: string, key: string, value: string) => {
    const next = rows.map((r) =>
      r.id === rowId ? updateRowCell(r, template, key, value) : r,
    );
    onChange(next);
  };

  const removeRow = (rowId: string) => {
    onChange(rows.filter((r) => r.id !== rowId));
  };

  const issueFor = (row: ExtractedRow, key: string) =>
    row.issues.find((i) => i.column === key && i.severity !== 'warning');

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {so ? 'Safka La Akhriyay' : 'Rows read'}
          </div>
          <div className="text-xl font-extrabold text-slate-900">{rows.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            Group {groupCode}
          </div>
          <div className="text-xl font-extrabold text-emerald-800">{f1Rows.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {so ? 'Kooxaha Kale' : 'Other groups'}
          </div>
          <div className="text-xl font-extrabold text-slate-500">{otherRows.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
            {so ? 'Baaritaan' : 'Need check'}
          </div>
          <div className="text-xl font-extrabold text-amber-800">{withIssues}</div>
        </div>
      </div>

      {warnings && warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-900 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {urgentCount > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 flex items-center gap-2 text-xs font-semibold text-rose-800">
          <Zap className="w-4 h-4 text-rose-600" />
          <span>
            {so
              ? `${urgentCount} ciladood ayaa DEGDEG ah (la aqoonsaday automaatig)`
              : `${urgentCount} ticket(s) auto-flagged URGENT (degdeg / dd / dadaji)`}
          </span>
        </div>
      )}

      {/* Preview + table */}
      <div className={showPreview && preview ? 'grid grid-cols-1 xl:grid-cols-5 gap-4' : ''}>
        {showPreview && preview && (
          <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <ImageIcon className="w-3.5 h-3.5" />
                {so ? 'Sawirka La Safeeyay' : 'Source picture (grid removed)'}
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
              <img src={preview} alt="Processed sheet" className="w-full h-auto block" />
              {gridLines && imageSize && (
                <svg
                  viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                  className="absolute inset-0 w-full h-full"
                  preserveAspectRatio="none"
                >
                  {gridLines.cols.map((x, i) => (
                    <line
                      key={`c${i}`}
                      x1={x}
                      y1={0}
                      x2={x}
                      y2={imageSize.height}
                      stroke="#059669"
                      strokeWidth={2}
                      opacity={0.35}
                    />
                  ))}
                  {gridLines.rows.map((y, i) => (
                    <line
                      key={`r${i}`}
                      x1={0}
                      y1={y}
                      x2={imageSize.width}
                      y2={y}
                      stroke="#0284c7"
                      strokeWidth={2}
                      opacity={0.3}
                    />
                  ))}
                </svg>
              )}
            </div>

            {titleText && (
              <p className="text-[11px] text-slate-500 italic px-1 line-clamp-2">{titleText}</p>
            )}
          </div>
        )}

        <div className={showPreview && preview ? 'xl:col-span-3 space-y-3' : 'space-y-3'}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950 text-white text-xs font-bold">
              <ScanLine className="w-3.5 h-3.5" />
              <span>
                {template.id === 'galinta'
                  ? so
                    ? 'Galinta'
                    : 'Pending Installation'
                  : so
                    ? 'Cilada'
                    : 'Active Faults'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowAllGroups((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                showAllGroups
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showAllGroups
                ? so
                  ? 'Dhammaan kooxaha'
                  : 'Showing all groups'
                : so
                  ? `Group ${groupCode} oo keliya`
                  : `Group ${groupCode} only`}
            </button>

            {preview && !showPreview && (
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                {so ? 'Muuji sawirka' : 'Show picture'}
              </button>
            )}

            <span className="text-[11px] text-slate-500 ml-auto inline-flex items-center gap-1">
              <Pencil className="w-3 h-3" />
              {so ? 'Guji unug kasta si aad u saxdo' : 'Tap any cell to fix it'}
            </span>
          </div>

          {/* Editable table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-2 py-2 text-left font-bold text-slate-500 w-8">#</th>
                    {template.columns.map((col) => (
                      <th
                        key={col.key}
                        className="px-2 py-2 text-left font-bold text-slate-600 whitespace-nowrap"
                        style={{ minWidth: col.width ?? 90 }}
                      >
                        {colLabel(col.labelEn, col.labelSo)}
                      </th>
                    ))}
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
                    const isOther =
                      row.derived.groupCode && row.derived.groupCode !== groupCode;
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 last:border-0 ${
                          isOther ? 'bg-slate-50/70 opacity-60' : 'hover:bg-emerald-50/30'
                        }`}
                      >
                        <td className="px-2 py-1.5 text-slate-400 font-mono">{idx + 1}</td>
                        {template.columns.map((col) => {
                          const value = row.raw[col.key] ?? '';
                          const issue = issueFor(row, col.key);
                          const isEditing =
                            editingCell?.rowId === row.id && editingCell?.key === col.key;
                          return (
                            <td key={col.key} className="px-1 py-1">
                              <div className="relative">
                                <input
                                  value={value}
                                  onChange={(e) => handleEdit(row.id, col.key, e.target.value)}
                                  onFocus={() => setEditingCell({ rowId: row.id, key: col.key })}
                                  onBlur={() => setEditingCell(null)}
                                  className={`w-full px-2 py-1.5 rounded-md border text-xs font-medium bg-transparent transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white ${
                                    issue
                                      ? 'border-rose-400 bg-rose-50/60 text-rose-900'
                                      : isEditing
                                        ? 'border-emerald-400'
                                        : 'border-transparent hover:border-slate-200'
                                  }`}
                                />
                                {issue && (
                                  <span
                                    title={issue.message}
                                    className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500"
                                  />
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            className="p-1 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title={so ? 'Tirtir safka' : 'Remove row'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={template.columns.length + 2}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        {so
                          ? 'Wax saf ah lama helin. Isku day inaad sawirka mar kale soo geliso.'
                          : 'No rows could be read. Try uploading the picture again or paste the table instead.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk markers legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 px-1">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              {so ? 'Unug aan la hubin' : 'Cell needs checking'}
            </span>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {so ? 'Wax walba waa la akhriyay' : 'Everything read'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Zap className="w-3 h-3 text-rose-500" />
              {so ? 'Degdeg' : 'Urgent'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
