import React from 'react';
import { RefreshCw, Wifi } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { greeting, updatedLabel } from '../../../lib/overview';
import { formatDateWithWeekday } from '../../../lib/format';
import { cx } from '../../ui/cx';

/**
 * The top of the command page.
 *
 * A greeting rather than a title, because the first thing a supervisor reads at
 * 07:30 should not be the name of the software. The date is the local one, the
 * freshness is measured in seconds since the last successful load, and the
 * refresh control is always present so nobody has to guess whether the page is
 * live.
 */
export function ShiftHeader({
  day,
  secondsAgo,
  refreshing,
  error,
  onRefresh,
  groupCode,
  userName,
  headline,
  tone,
}: {
  day: string;
  secondsAgo: number | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  groupCode: string;
  userName: string;
  /** The one sentence that says what today is about. */
  headline: string | null;
  tone: 'calm' | 'attention' | 'urgent';
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const hour = new Date().getHours();

  return (
    <header className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700">
            {greeting(hour, lang)}
            {userName ? ` · ${userName}` : ''}
          </p>
          <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight mt-0.5">
            {so ? 'Guudmarka Maamulka' : 'Command overview'}
          </h1>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
            {formatDateWithWeekday(day, lang)} · {so ? 'Kooxda' : 'Group'} {groupCode}
          </p>

          {/* The page's own conclusion, before any number. Ordered by what a
              supervisor must act on, not by what is largest. */}
          {headline && (
            <p
              className={cx(
                'mt-1.5 text-xs font-bold leading-snug',
                tone === 'urgent'
                  ? 'text-rose-800'
                  : tone === 'attention'
                    ? 'text-amber-800'
                    : 'text-brand-800',
              )}
            >
              {headline}
            </p>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={so ? 'Cusboonaysii' : 'Refresh'}
            className="inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl bg-slate-100 text-slate-800 font-bold text-[11px] hover:bg-slate-200 disabled:opacity-60 transition cursor-pointer"
          >
            <RefreshCw
              className={cx('w-3.5 h-3.5', refreshing && 'animate-spin')}
              aria-hidden="true"
            />
            {so ? 'Cusboonaysii' : 'Refresh'}
          </button>
          <span className="text-[10px] font-semibold text-slate-500" aria-live="polite">
            {error ? (so ? 'Xogta si buuxda looma soo qaadin' : 'Partly out of date') : updatedLabel(secondsAgo, lang)}
          </span>
        </div>
      </div>

      {/* The live indicator says what it actually knows: this page refetches
          itself when the database changes. If the socket is unavailable the
          label stays honest rather than claiming a live feed that is not live. */}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
        <Wifi className="w-3 h-3 text-brand-600" aria-hidden="true" />
        {so ? 'Si toos ah ayuu isku cusboonaysiiyaa marka shaqadu is beddesho.' : 'Updates itself when a job changes.'}
      </div>
    </header>
  );
}
