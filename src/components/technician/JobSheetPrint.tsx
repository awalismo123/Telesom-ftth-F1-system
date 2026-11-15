import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { RouteTask } from '../../lib/execution';
import { SHEET_NOTE, jobReference, sheetFields } from '../../lib/jobSheet';
import { formatDate } from '../../lib/format';
import { TelesomEmblem } from '../brand/TelesomLogo';
import { BUILD_LABEL } from '../../lib/version';

/**
 * One job, on one page, printable.
 *
 * "Print to PDF" is the browser's own dialogue: no bundle bytes, no upload, and
 * the same mechanism the period report already uses.
 *
 * **Privacy.** A job sheet carries a customer's name, phone and address. This
 * opens only when somebody presses the button for **this** job — there is no
 * "print all", and nothing else on the screen prints differently. The body is
 * marked so the print stylesheet hides the app behind it.
 */
export function JobSheetPrint({
  task,
  lang,
  assignee,
  onClose,
}: {
  task: RouteTask;
  lang: 'so' | 'en';
  assignee?: string | null;
  onClose: () => void;
}) {
  const so = lang === 'so';
  const fields = sheetFields(task, lang, assignee);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // `print-root` is what index.css keys on: while it is on the page, `> #root`
  // is hidden for print. Without it the app behind this sheet prints as well and
  // the paper carries a screenshot of the app.
  return createPortal(
    <div className="print-root fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 print:static print:bg-white print:overflow-visible">
      <div className="min-h-full flex items-start justify-center p-3 sm:p-6 print:p-0">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl print:shadow-none print:rounded-none print:max-w-none">
          {/* controls — never on paper */}
          <div className="no-print flex items-center gap-2 px-4 py-3 border-b border-slate-200">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-brand-700 text-white font-extrabold text-xs active:scale-[0.99] transition cursor-pointer"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              {so ? 'Daabac' : 'Print'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              {so ? 'Xir' : 'Close'}
            </button>
          </div>

          <div className="p-5 sm:p-7 space-y-4 print:p-0">
            {/* letterhead */}
            <div className="print-colour flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
              <div className="flex items-start gap-3 min-w-0">
                <TelesomEmblem className="w-12 h-[32px] shrink-0" title="Telesom" />
                <div className="min-w-0">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-brand-800">
                    Telesom · Fixed Broadband
                  </div>
                  <h1 className="text-xl font-extrabold text-slate-900 leading-tight">
                    {so ? 'Warqadda Shaqada' : 'Job Sheet'}
                  </h1>
                  <div className="text-xs font-semibold text-slate-600 mt-0.5">
                    {so ? 'Kooxda F1' : 'Group F1'}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-sm font-extrabold text-slate-900">
                  {jobReference(task.id)}
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
                  {task.reported_date ? formatDate(task.reported_date) : ''}
                </div>
              </div>
            </div>

            {/* the fields, whatever survived the empty check */}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 print:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.label}
                  className={field.wide ? 'sm:col-span-2 print:col-span-2' : undefined}
                >
                  <dt className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                    {field.label}
                  </dt>
                  <dd className="text-sm font-semibold text-slate-900 break-words whitespace-pre-wrap">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* signature — a sheet that gets filed is signed */}
            <div className="pt-6 grid grid-cols-2 gap-8 print-block">
              <div className="border-t border-slate-400 pt-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {so ? 'Saxeexa shaqaalaha' : 'Technician signature'}
                </div>
              </div>
              <div className="border-t border-slate-400 pt-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {so ? 'Saxeexa macmiilka' : 'Customer signature'}
                </div>
              </div>
            </div>

            <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-200 pt-2">
              {SHEET_NOTE[lang]} · {BUILD_LABEL}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
