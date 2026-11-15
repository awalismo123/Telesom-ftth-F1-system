import React, { useEffect, useState } from 'react';
import { AlarmClock, MapPin, Phone } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { SLA_NOTE, dueToday, lateNote, slaHeadline, slaHeading, type SlaWatch } from '../../lib/slaWatch';
import { fetchSlaWatch } from '../../lib/slaWatchService';
import { statusLabel } from '../../lib/ops';

/**
 * Jobs that reach the three-day promise today.
 *
 * Every other number on this screen counts work that is already late. This is
 * the only one a supervisor can still fix, so it is worth its own card.
 *
 * * It renders **nothing** until it knows, and nothing at all if the fetch fails
 *   or there is nothing due — an empty card would read as a loading failure.
 * * It never shows a job that is already late: those have their own tile.
 * * Rows are plain text, not buttons, because there is no per-job sheet on the
 *   Today tab and a control that does nothing is worse than none.
 */
export function SlaWatchCard() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const [watch, setWatch] = useState<SlaWatch | null>(null);

  const token = session?.token ?? null;
  const groupId = activeGroup?.id ?? null;

  useEffect(() => {
    if (!token || !groupId) return;
    let cancelled = false;
    setWatch(null);

    // Refresh when the tab regains focus: a supervisor keeps this screen open
    // all day and the deadline moves at midnight, not on a timer.
    const load = () => {
      void fetchSlaWatch(token, groupId)
        .then((result) => !cancelled && setWatch(result))
        .catch(() => {
          /* the rest of the panel is still valid */
        });
    };

    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [token, groupId]);

  if (!watch) return null;

  const jobs = dueToday(watch);
  const late = lateNote(watch.late_count, lang);

  if (jobs.length === 0) {
    return (
      <p className="mt-3 text-[11px] font-semibold text-slate-500">
        {slaHeadline(watch, lang)}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <AlarmClock className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
          {slaHeading(lang)}
        </span>
      </div>

      <p className="text-[11px] font-bold text-amber-900">{slaHeadline(watch, lang)}</p>

      <ul className="divide-y divide-amber-200/60">
        {jobs.map((job) => (
          <li key={job.id} className="py-1.5 space-y-0.5">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] font-extrabold text-slate-900">
                {job.line_number}
              </span>
              <span className="text-[11px] font-bold text-slate-800 truncate">
                {job.customer_name ?? '—'}
              </span>
              {job.priority === 'urgent' && (
                <span className="text-[10px] font-extrabold text-rose-700">DEGDEG</span>
              )}
              <span className="ml-auto text-[10px] font-bold text-amber-800 shrink-0">
                {statusLabel(job.status, lang)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-600">
              <span className="font-semibold">
                {job.is_unassigned ? (so ? 'cidna lama qorin' : 'nobody assigned') : job.assignee}
              </span>
              {job.xaafada && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="w-2.5 h-2.5" aria-hidden="true" />
                  {job.xaafada}
                </span>
              )}
              {/* tel: link — a supervisor ringing the customer is the fastest
                  fix for a job that is about to be late. */}
              {job.customer_phone && (
                <a
                  href={`tel:${job.customer_phone.replace(/\s+/g, '')}`}
                  className="ml-auto inline-flex items-center gap-0.5 font-bold text-brand-700 shrink-0"
                >
                  <Phone className="w-2.5 h-2.5" aria-hidden="true" />
                  {so ? 'Wac' : 'Call'}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {late && <p className="text-[10px] font-semibold text-slate-600">{late}</p>}

      <p className="text-[10px] leading-snug text-amber-900/80 border-t border-amber-200/60 pt-1.5">
        {SLA_NOTE[lang]}
      </p>
    </div>
  );
}
