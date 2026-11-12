import React from 'react';
import { AlertTriangle, ArrowRight, CircleCheck, Clock, Truck, UserX } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { todayHeadline, headlineTone, todayItems, type TodaySummary } from '../../lib/today';
import { SkeletonCard } from '../ui/Skeleton';
import { cx } from '../ui/cx';

/**
 * The first thing a supervisor sees.
 *
 * Replaces a build-progress roadmap that said "Phase 1 Live" five times. The
 * rule for this panel: every line answers a question someone asks out loud at
 * the start of a shift. Nothing here is a total for its own sake.
 *
 * The headline is deliberately one sentence, chosen by priority rather than by
 * size — blocked outranks overdue, overdue outranks unassigned. A supervisor
 * who reads only the largest number would otherwise fix the wrong thing first.
 */

const ICONS: Record<string, React.ReactNode> = {
  blocked: <AlertTriangle className="w-4 h-4" />,
  overdue: <Clock className="w-4 h-4" />,
  unassigned: <UserX className="w-4 h-4" />,
  out: <Truck className="w-4 h-4" />,
  closed: <CircleCheck className="w-4 h-4" />,
};

const HEADLINE_STYLE: Record<string, string> = {
  calm: 'from-emerald-950 via-slate-900 to-emerald-950 border-emerald-800/50',
  attention: 'from-amber-950 via-slate-900 to-amber-950 border-amber-700/50',
  urgent: 'from-rose-950 via-slate-900 to-rose-950 border-rose-700/50',
};

const TILE_TONE: Record<string, string> = {
  calm: 'text-emerald-300',
  attention: 'text-amber-400',
  urgent: 'text-rose-400',
};

export function TodayPanel({
  summary,
  loading,
  onNavigate,
}: {
  summary: TodaySummary | null;
  loading: boolean;
  onNavigate: (tab: 'dispatch' | 'team' | 'insights') => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';

  if (loading && !summary) return <SkeletonCard lines={4} />;

  if (!summary) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <p className="text-sm font-semibold text-slate-600">
          {so
            ? 'Tirooyinka maanta lama soo qaadi karin. Xogtaada kale way shaqaynaysaa.'
            : 'Today\u2019s counts could not be loaded. Everything else still works.'}
        </p>
      </div>
    );
  }

  const tone = headlineTone(summary);
  const items = todayItems(summary, lang);

  return (
    <section aria-labelledby="today-heading" className="space-y-3">
      <div
        className={cx(
          'rounded-3xl bg-gradient-to-br text-white p-5 sm:p-6 shadow-lg border',
          HEADLINE_STYLE[tone],
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-bold mb-2">
              {so ? 'MAANTA' : 'TODAY'}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{summary.day}</span>
            </div>
            <h2 id="today-heading" className="text-base sm:text-lg font-extrabold leading-snug">
              {todayHeadline(summary, lang)}
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mt-5">
          {items.map((item) => {
            const Wrapper = item.tab ? 'button' : 'div';
            return (
              <Wrapper
                key={item.id}
                {...(item.tab
                  ? { type: 'button' as const, onClick: () => onNavigate(item.tab!) }
                  : {})}
                className={cx(
                  'text-left rounded-2xl bg-white/5 border border-white/10 p-3 min-h-[76px]',
                  item.tab && 'hover:bg-white/10 hover:border-white/20 transition cursor-pointer',
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={TILE_TONE[item.tone]} aria-hidden="true">
                    {ICONS[item.id]}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white/60 truncate">
                    {item.label}
                  </span>
                </div>
                <div className="text-xl font-extrabold tabular-nums leading-none">{item.value}</div>
                <div className="text-[10px] font-semibold text-white/60 mt-1 leading-tight">
                  {item.hint}
                </div>
              </Wrapper>
            );
          })}
        </div>

        {summary.unassigned > 0 && (
          <button
            type="button"
            onClick={() => onNavigate('dispatch')}
            className="mt-4 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-extrabold text-xs transition cursor-pointer"
          >
            {so ? 'Qaybsiga fur' : 'Open dispatch'}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
