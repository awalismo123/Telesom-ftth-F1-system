import React, { useEffect, useState } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import {
  REPEAT_NOTE,
  faultHistoryCopy,
  investigateCopy,
  needsInvestigation,
  type RepeatCount,
} from '../../lib/repeatFaults';
import { fetchRepeatFaultCount } from '../../lib/repeatFaultsService';

/**
 * "This customer has had N faults in 90 days."
 *
 * Shown on the job sheet for both roles, because both stand in front of the
 * customer: the technician deciding whether to look harder at the drop cable,
 * and the supervisor deciding whether to send someone who can replace it.
 *
 * Two deliberate behaviours:
 *
 * * **Renders nothing until it knows.** No skeleton, no placeholder — a flash of
 *   "0 faults" that becomes "3 faults" would be worse than waiting a moment.
 * * **A failed fetch renders nothing.** This is context, not a control; an error
 *   banner over a customer's fault history would make the job sheet look broken
 *   for something that does not block any action.
 *
 * Under the threshold it is a quiet grey line. At or above it turns amber and
 * says *"worth investigating"* — never "repeat offender", because that is a
 * judgement about the person rather than a fact about the line.
 */

interface Props {
  token: string;
  taskId: string;
  lang: 'so' | 'en';
}

export function RepeatFaultBadge({ token, taskId, lang }: Props) {
  const so = lang === 'so';
  const [count, setCount] = useState<RepeatCount | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCount(null);

    void fetchRepeatFaultCount(token, taskId)
      .then((result) => !cancelled && setCount(result))
      .catch(() => {
        /* context only — never blocks the job sheet */
      });

    return () => {
      cancelled = true;
    };
  }, [token, taskId]);

  // Nothing known yet, no line number, or the fetch failed — say nothing rather
  // than invent a figure.
  if (!count || !count.known) return null;

  const flagged = needsInvestigation(count);

  if (!flagged) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-slate-500">
        <History className="w-3 h-3 shrink-0" aria-hidden="true" />
        {faultHistoryCopy(count.faults, count.days, lang)}
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2 space-y-1">
      <p className="flex items-start gap-1.5 text-[11px] font-extrabold text-amber-900">
        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
        {investigateCopy(count.faults, count.days, lang)}
      </p>
      <p className="text-[10px] leading-snug text-amber-800 pl-5">{REPEAT_NOTE[lang]}</p>
      {count.jobs.length > 0 && (
        <p className="text-[10px] font-mono text-amber-900/80 pl-5">
          {count.jobs
            .slice(0, 4)
            .map((job) => job.reported_date ?? '—')
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
