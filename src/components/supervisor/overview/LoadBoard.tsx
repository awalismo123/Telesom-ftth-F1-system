import React from 'react';
import { AlertTriangle, Truck, User } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { idleRows, loadRows, loadSummary, type LoadRow } from '../../../lib/overview';
import type { DispatchLoad } from '../../../lib/dispatchService';
import { formatNumber } from '../../../lib/format';
import { cx } from '../../ui/cx';

/**
 * Who is carrying what.
 *
 * Alphabetical, never by workload — a list ordered by open jobs is a leaderboard
 * with a different title, and the question this panel answers is "who is free".
 *
 * A crew with nobody in it is shown **and flagged**. Assigning work to it sends
 * the job nowhere while looking like it was sent, so hiding it would be the more
 * dangerous choice.
 */
export function LoadBoard({
  load,
  loading,
  onOpenTeam,
}: {
  load: DispatchLoad;
  loading: boolean;
  onOpenTeam: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const rows = loadRows(load);

  return (
    <section
      aria-labelledby="load-heading"
      className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Truck className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />
        <h2 id="load-heading" className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {so ? 'Culeyska shaqaalaha' : 'Who is carrying what'}
        </h2>
        <button
          type="button"
          onClick={onOpenTeam}
          className="ml-auto min-h-11 px-2 -my-2 text-[11px] font-bold text-brand-700 hover:text-brand-800 cursor-pointer"
        >
          {so ? 'Maamul' : 'Manage'}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-[11px] font-semibold text-slate-500">
          {so
            ? 'Weli cid lama diiwaangelin. Ku dar farsamayaqaan ama koox.'
            : 'Nobody on the roster yet. Add a technician or a crew.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <LoadRowItem key={row.key} row={row} />
            ))}
          </ul>

          <p className="text-[10px] leading-snug text-slate-500 border-t border-slate-100 pt-1.5">
            {loadSummary(rows, lang)}
          </p>
        </>
      )}
    </section>
  );
}

function LoadRowItem({ row }: { row: LoadRow }) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const idle = row.open === 0 && !row.stranded;

  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        className={cx(
          'w-6 h-6 rounded-lg flex items-center justify-center shrink-0',
          row.stranded
            ? 'bg-rose-100 text-rose-700'
            : idle
              ? 'bg-brand-100 text-brand-800'
              : 'bg-slate-100 text-slate-600',
        )}
        aria-hidden="true"
      >
        {row.stranded ? (
          <AlertTriangle className="w-3 h-3" />
        ) : row.kind === 'crew' ? (
          <Truck className="w-3 h-3" />
        ) : (
          <User className="w-3 h-3" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-extrabold text-slate-900 truncate">{row.name}</span>
          {row.stranded && (
            <span className="text-[10px] font-bold text-rose-700 shrink-0">
              {so ? 'xubno la’aan' : 'no members'}
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-500 truncate">
          {row.stranded
            ? so
              ? 'Lama qaybin karo'
              : 'Cannot be dispatched to'
            : row.members.length > 0
              ? row.members.join(' · ')
              : (row.subtitle ?? (so ? 'Farsamayaqaan' : 'Technician'))}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold">
        {row.active > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-brand-100 text-brand-800" title={so ? 'socda' : 'running'}>
            {row.active}
          </span>
        )}
        {row.urgent > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700" title={so ? 'degdeg' : 'urgent'}>
            {row.urgent}
          </span>
        )}
        <span className="font-mono text-slate-900 tabular" title={so ? 'furan' : 'open'}>
          {formatNumber(row.open)}
        </span>
        {row.done_today > 0 && (
          <span className="font-mono text-slate-500 tabular" title={so ? 'maanta la dhammeeyay' : 'closed today'}>
            +{formatNumber(row.done_today)}
          </span>
        )}
      </div>
    </li>
  );
}

/** Exported for the shell's "who is free" line. */
export { idleRows };
