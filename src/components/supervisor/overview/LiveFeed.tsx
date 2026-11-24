import React from 'react';
import { CircleCheck, CircleDot, TriangleAlert } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { activityLabel, activityTone, type ActivityEvent } from '../../../lib/activity';
import { formatDateLong } from '../../../lib/format';
import { lastActivityDay, recentEvents } from '../../../lib/overview';
import { timeAgoShort } from '../../../lib/registry';
import { cx } from '../../ui/cx';

/**
 * The last few things that happened.
 *
 * Deliberately not filtered to problems. A feed that only shows bad news trains
 * a supervisor to ignore it, and a completion is the most useful thing on this
 * page — it means a crew is moving.
 */
export function LiveFeed({
  events,
  loading,
  onOpenAll,
}: {
  events: readonly ActivityEvent[];
  loading: boolean;
  onOpenAll: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const rows = recentEvents(events, 6);
  const lastActivity = rows.length === 0 ? lastActivityDay(events) : null;

  return (
    <section
      aria-labelledby="feed-heading"
      className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-2"
    >
      <div className="flex items-center gap-1.5">
        <CircleDot className="w-3.5 h-3.5 text-brand-700" aria-hidden="true" />
        <h2 id="feed-heading" className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {so ? 'Dhacdooyin' : 'Live activity'}
        </h2>
        <button
          type="button"
          onClick={onOpenAll}
          className="ml-auto min-h-11 px-2 -my-2 text-[11px] font-bold text-brand-700 hover:text-brand-800 cursor-pointer"
        >
          {so ? 'Dhammaan' : 'See all'}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        // "Nothing happened" and "the feed is broken" look identical without a
        // date, so the last busy day is named when one can be found.
        <p className="py-3 text-[11px] font-semibold text-slate-500">
          {lastActivity
            ? so
              ? `Dhaqaaq ma jiro 30-kii maalmood. Markii ugu dambaysay: ${formatDateLong(lastActivity, lang)}.`
              : `No movement in 30 days. Last activity was ${formatDateLong(lastActivity, lang)}.`
            : so
              ? 'Weli dhacdo lama diiwaangelin.'
              : 'Nothing has been recorded yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((event, index) => (
            <FeedRow key={`${event.at}-${event.task_id ?? index}-${index}`} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedRow({ event }: { event: ActivityEvent }) {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const tone = activityTone(event.kind);

  const Icon = tone === 'good' ? CircleCheck : tone === 'bad' ? TriangleAlert : CircleDot;
  const iconClass =
    tone === 'good'
      ? 'text-brand-700'
      : tone === 'bad'
        ? 'text-rose-700'
        : tone === 'warn'
          ? 'text-amber-700'
          : 'text-slate-500';

  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className={cx('mt-0.5 shrink-0', iconClass)} aria-hidden="true">
        <Icon className="w-3 h-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-extrabold text-slate-900 shrink-0">
            {activityLabel(event.kind, lang)}
          </span>
          {event.line_number && (
            <span className="font-mono text-[10px] font-bold text-slate-600 truncate">
              {event.line_number}
            </span>
          )}
          <span className="ml-auto text-[10px] font-semibold text-slate-500 shrink-0">
            {timeAgoShort(event.at, lang)}
          </span>
        </div>
        <div className="text-[10px] text-slate-500 truncate">
          {event.subject === 'dispatch'
            ? `${event.actor} · ${event.task_count ?? 0} ${so ? 'shaqo' : 'jobs'} · ${event.channel ?? ''}`
            : `${event.actor}${event.notes ? ` · ${event.notes}` : ''}`}
        </div>
      </div>
    </li>
  );
}
