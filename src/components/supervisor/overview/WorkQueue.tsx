import React from 'react';
import { AlertTriangle, ArrowRight, Clock, MapPin, Phone } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { WORK_NOTE, queueRemainder, workQueue, type WorkRow } from '../../../lib/overview';
import { statusLabel } from '../../../lib/ops';
import { formatDate } from '../../../lib/format';
import { OPEN_TASK_CAP, truncatedNotice } from '../../../lib/lists';
import type { Task } from '../../../types/database';
import { cx } from '../../ui/cx';

/**
 * The jobs to attack first.
 *
 * Urgent ahead, then oldest. Every row can be actioned from here: tap the phone
 * number to call, tap the row to open the job on the dispatch board. This is the
 * difference between a dashboard that reports a backlog and one that can start
 * clearing it.
 */

const TONE: Record<WorkRow['tone'], { chip: string; label: (lang: 'en' | 'so') => string }> = {
  urgent: {
    chip: 'bg-rose-100 text-rose-800',
    label: (lang) => (lang === 'so' ? 'Degdeg' : 'Urgent'),
  },
  late: {
    chip: 'bg-rose-100 text-rose-800',
    label: (lang) => (lang === 'so' ? 'Daahday' : 'Late'),
  },
  due: {
    chip: 'bg-amber-100 text-amber-900',
    label: (lang) => (lang === 'so' ? 'Maanta' : 'Due today'),
  },
  normal: {
    chip: 'bg-slate-100 text-slate-700',
    label: () => '',
  },
};

export function WorkQueue({
  tasks,
  today,
  loading,
  totalOpen,
  onOpenTask,
  onOpenDispatch,
}: {
  tasks: readonly Task[];
  today: string;
  loading: boolean;
  totalOpen: number;
  onOpenTask: (taskId: string) => void;
  onOpenDispatch: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const rows = workQueue(tasks, today, 8);
  const remainder = queueRemainder(totalOpen, rows.length);
  /**
   * The database caps the open list at 600 rows. Below the cap `totalOpen` is
   * exact, so the remainder is a real count; at the cap a supervisor would read
   * a number that is really "at least this much", so it is named as such.
   */
  const truncated = truncatedNotice(tasks.length, OPEN_TASK_CAP, lang);

  return (
    <section
      aria-labelledby="queue-heading"
      className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-2"
    >
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
        <h2 id="queue-heading" className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {so ? 'Shaqada ugu horeysa' : 'Next jobs to work'}
        </h2>
        <button
          type="button"
          onClick={onOpenDispatch}
          className="ml-auto inline-flex items-center gap-1 min-h-11 px-2 -my-2 text-[11px] font-bold text-brand-700 hover:text-brand-800 cursor-pointer"
        >
          {so ? 'Qaybsiga' : 'Dispatch'}
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-[11px] font-semibold text-slate-500">
          {so ? 'Shaqo furan ma jirto. Safka waa madhan yahay.' : 'No open jobs. The queue is clear.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const tone = TONE[row.tone];
              const chip = tone.label(lang);

              return (
                <li key={row.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenTask(row.id)}
                    className="flex-1 min-w-0 text-left py-2 hover:bg-slate-50 rounded-lg px-1 -mx-1 transition cursor-pointer"
                  >
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] font-extrabold text-slate-900">
                        {row.line_number}
                      </span>
                      <span className="text-[11px] font-bold text-slate-800 truncate">
                        {row.customer_name ?? '—'}
                      </span>
                      {chip && (
                        <span className={cx('text-[10px] font-extrabold px-1.5 py-0.5 rounded', tone.chip)}>
                          {chip}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] font-bold text-slate-500 shrink-0">
                        {statusLabel(row.status, lang)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 text-[10px] text-slate-500 mt-0.5">
                      {row.xaafada && (
                        <span className="inline-flex items-center gap-0.5 min-w-0 truncate">
                          <MapPin className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          {row.xaafada}
                        </span>
                      )}
                      <span className="shrink-0">
                        {row.days === null
                          ? so
                            ? 'maalin lama garanayo'
                            : 'age unknown'
                          : row.days === 0
                            ? so
                              ? 'maanta'
                              : 'today'
                            : so
                              ? `${row.days} maalmood`
                              : `${row.days} ${row.days === 1 ? 'day' : 'days'}`}
                      </span>
                      {row.reported_date && (
                        <span className="ml-auto shrink-0 font-mono">{formatDate(row.reported_date)}</span>
                      )}
                    </div>
                  </button>

                  {/* Calling the customer is the fastest way to unstick a job
                      that is about to break the promise. */}
                  {row.customer_phone && (
                    <a
                      href={`tel:${row.customer_phone.replace(/[^\d+]/g, '')}`}
                      aria-label={`${so ? 'Wac' : 'Call'} ${row.customer_name ?? row.line_number}`}
                      className="self-center shrink-0 inline-flex items-center justify-center w-11 min-h-11 rounded-xl text-brand-700 hover:bg-brand-50 transition"
                    >
                      <Phone className="w-4 h-4" aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          {truncated ? (
            <p className="text-[10px] font-semibold text-amber-800 border-t border-slate-100 pt-1.5">
              {truncated}
            </p>
          ) : (
            remainder > 0 && (
              <p className="text-[10px] font-semibold text-slate-500 border-t border-slate-100 pt-1.5">
                {so
                  ? `${remainder} shaqo oo kale ayaa sugaysa.`
                  : `${remainder} more waiting in dispatch.`}
              </p>
            )
          )}

          <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-100 pt-1.5">
            {WORK_NOTE[lang]}
          </p>
        </>
      )}
    </section>
  );
}

/** Kept for the shell's error state. */
export { AlertTriangle };
