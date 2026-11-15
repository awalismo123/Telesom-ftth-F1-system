import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../lib/format';
import { statusLabel } from '../../lib/ops';
import {
  HISTORY_NOTE,
  dbmLabel,
  hasHistory,
  historyLabel,
  jobTypeLabel,
  lastDbm,
  noHistoryCopy,
  noLineCopy,
  previousJobs,
  steadySignal,
  type LineHistory,
} from '../../lib/lineHistory';
import { fetchLineHistory } from '../../lib/lineHistoryService';

/**
 * "Somebody has been here before."
 *
 * Collapsed until it is opened, and it does not fetch until then either — a
 * technician opening a job should not pay for a query they did not ask for.
 *
 * The panel says one of three things, and never confuses them:
 *
 * * the job has no line number, so there is nothing to look up;
 * * the line has no earlier jobs;
 * * here are the earlier jobs.
 *
 * An empty box would read as "still loading" and a technician would wait for it.
 */

interface Props {
  taskId: string;
  lineNumber: string | null;
  lang: 'so' | 'en';
}

export function LineHistoryPanel({ taskId, lineNumber, lang }: Props) {
  const { session, activeGroup } = useAuth();
  const token = session?.token ?? null;
  const groupId = activeGroup?.id ?? null;

  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<LineHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const line = (lineNumber ?? '').trim();

  // No line, no panel: there is nothing honest to show.
  if (!line) {
    return (
      <p className="flex items-start gap-1.5 px-1 text-[11px] text-slate-500">
        <History className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
        {noLineCopy(lang)}
      </p>
    );
  }

  const load = () => {
    const next = !open;
    setOpen(next);
    if (!next || history || !token || !groupId) return;

    setLoading(true);
    setFailed(false);
    void fetchLineHistory({ token, groupId, lineNumber: line, excludeTaskId: taskId })
      .then((result) => setHistory(result))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const jobs = previousJobs(history, taskId);
  const dbm = lastDbm(jobs);
  const steady = steadySignal(jobs);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={load}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 min-h-11 text-[11px] font-bold text-slate-700 active:scale-[0.99] transition cursor-pointer"
      >
        <History className="w-3.5 h-3.5 text-brand-700 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {history && hasHistory(jobs)
            ? historyLabel(jobs.length, lang)
            : lang === 'so'
              ? 'Shaqooyin hore'
              : 'Earlier jobs on this line'}
        </span>
        <span className="ml-auto shrink-0 text-slate-500">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          {loading && (
            <p className="text-[11px] italic text-slate-500">
              {lang === 'so' ? 'Waa la raadinayaa…' : 'Looking…'}
            </p>
          )}

          {failed && !loading && (
            <p className="text-[11px] text-rose-700">
              {lang === 'so'
                ? 'Taariikhda lama soo qaadin. Isku day mar kale.'
                : 'Could not load the history. Try again.'}
            </p>
          )}

          {!loading && !failed && history && !hasHistory(jobs) && (
            <p className="text-[11px] italic text-slate-500">{noHistoryCopy(lang)}</p>
          )}

          {!loading && !failed && hasHistory(jobs) && (
            <>
              <ul className="divide-y divide-slate-100">
                {jobs.map((row) => {
                  const cancelled = row.status === 'cancelled';
                  return (
                    <li key={row.id} className="py-1.5 space-y-0.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-[11px] font-bold text-slate-700">
                          {row.sort_date ? formatDate(row.sort_date) : '—'}
                        </span>
                        <span
                          className={`text-[10px] font-extrabold px-1 rounded ${
                            row.task_type === 'cilada'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-brand-100 text-brand-800'
                          }`}
                        >
                          {jobTypeLabel(row.task_type, lang)}
                        </span>
                        <span
                          className={`text-[10px] font-bold ${
                            cancelled ? 'text-slate-500 line-through' : 'text-slate-600'
                          }`}
                        >
                          {statusLabel(row.status, lang)}
                        </span>
                        {row.optical_dbm !== null && (
                          <span className="ml-auto font-mono text-[11px] font-bold text-slate-900 shrink-0">
                            {dbmLabel(row.optical_dbm, lang)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2 text-[10px] text-slate-500">
                        <span className="truncate">
                          {row.technician ?? (lang === 'so' ? 'lama qorin' : 'not recorded')}
                        </span>
                        {row.cablebox_code_raw && (
                          <span className="ml-auto shrink-0 font-mono">{row.cablebox_code_raw}</span>
                        )}
                      </div>
                      {(row.completion_notes || row.cancel_reason) && (
                        <p className="text-[10px] text-slate-600 leading-snug">
                          {row.completion_notes ?? row.cancel_reason}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* A reading that has not moved across visits points at the line
                  rather than at whatever the customer is doing indoors. */}
              {steady && (
                <p className="text-[10px] font-semibold text-amber-800">
                  {lang === 'so'
                    ? `Akhriska isku mid ah ${steady.readings} jeer — dhibaatada waxay u badan tahay inay ku jirto xariiqa ama splitter-ka.`
                    : `Same reading ${steady.readings} times — the fault is more likely in the drop or splitter than indoors.`}
                </p>
              )}

              {dbm === null && jobs.length > 0 && (
                <p className="text-[10px] text-slate-500">
                  {lang === 'so' ? 'Akhris dBm lama qorin.' : 'No dBm readings recorded.'}
                </p>
              )}
            </>
          )}

          <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-100 pt-1.5">
            {HISTORY_NOTE[lang]}
          </p>
        </div>
      )}
    </div>
  );
}
