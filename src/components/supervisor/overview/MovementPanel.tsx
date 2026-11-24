import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import {
  lastActivityDay,
  movementSeries,
  movementSummary,
  seriesPeak,
  type DayPoint,
} from '../../../lib/overview';
import type { ActivityEvent } from '../../../lib/activity';
import { formatNumber } from '../../../lib/format';

/**
 * Arrived versus closed, seven days.
 *
 * Two lines, not one net figure: "+4 net" is equally true of a day where twelve
 * arrived and eight closed and of a day where four arrived and none did — and
 * those are very different days for the people standing in the street.
 *
 * Empty days are drawn as gaps rather than skipped. A sparkline that omits them
 * compresses a quiet week into a busy-looking line.
 */
export function MovementPanel({
  events,
  today,
  loading,
}: {
  events: readonly ActivityEvent[];
  today: string;
  loading: boolean;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const series = movementSeries(events, today, 7, lang);
  const peak = seriesPeak(series);
  const arrived = series.reduce((sum, point) => sum + point.arrived, 0);
  const closed = series.reduce((sum, point) => sum + point.closed, 0);
  const net = arrived - closed;

  return (
    <section
      aria-labelledby="movement-heading"
      className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-2.5"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={net > 0 ? 'text-rose-600' : 'text-brand-700'}
          aria-hidden="true"
        >
          {net > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        </span>
        <h2 id="movement-heading" className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {so ? 'Toddobaadkan' : 'Last seven days'}
        </h2>
        <span className="ml-auto flex items-center gap-2 text-[10px] font-bold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-400" aria-hidden="true" />
            {so ? 'yimid' : 'arrived'}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-brand-600" aria-hidden="true" />
            {so ? 'dhammaaday' : 'closed'}
          </span>
        </span>
      </div>

      {loading && arrived === 0 && closed === 0 ? (
        <div className="h-24 rounded-xl bg-slate-100 animate-pulse" aria-hidden="true" />
      ) : (
        <>
          <div
            className="flex items-end gap-1.5 h-24"
            role="img"
            aria-label={movementSummary(series, lang, lastActivityDay(events))}
          >
            {series.map((point) => (
              <DayColumn key={point.date} point={point} peak={peak} />
            ))}
          </div>

          <div className="flex gap-1.5">
            {series.map((point) => (
              <div key={point.date} className="flex-1 text-center text-[10px] font-bold text-slate-500">
                {point.label}
              </div>
            ))}
          </div>

          <p className="text-[11px] font-semibold text-slate-700 border-t border-slate-100 pt-1.5">
            {movementSummary(series, lang, lastActivityDay(events))}
          </p>
        </>
      )}
    </section>
  );
}

function DayColumn({ point, peak }: { point: DayPoint; peak: number }) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const arrivedPct = Math.round((point.arrived / peak) * 100);
  const closedPct = Math.round((point.closed / peak) * 100);

  return (
    <div
      className="flex-1 flex flex-col justify-end gap-0.5 h-full"
      title={`${point.date} · ${point.arrived} ${so ? 'yimid' : 'arrived'} · ${point.closed} ${so ? 'dhammaaday' : 'closed'}`}
    >
      <div className="flex items-end gap-0.5 h-full">
        <div
          className="flex-1 rounded-t-sm bg-amber-400"
          style={{ height: `${Math.max(point.arrived > 0 ? 6 : 2, arrivedPct)}%` }}
        />
        <div
          className="flex-1 rounded-t-sm bg-brand-600"
          style={{ height: `${Math.max(point.closed > 0 ? 6 : 2, closedPct)}%` }}
        />
      </div>
      <div className="text-center text-[10px] font-bold text-slate-500 tabular">
        {point.arrived + point.closed > 0 ? formatNumber(point.arrived + point.closed) : ''}
      </div>
    </div>
  );
}
