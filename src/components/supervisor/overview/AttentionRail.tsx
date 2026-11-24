import React from 'react';
import { AlertTriangle, AlarmClock, Clock, Truck, UserX, Zap } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { attentionItems, type AttentionInput } from '../../../lib/overview';
import { cx } from '../../ui/cx';

/**
 * The five numbers that mean somebody has to do something.
 *
 * A total is not a task, so "open" and "completed" are deliberately absent.
 * Each tile here has an action behind it, and a tile whose number is zero is
 * flat and inert — a control that invites a tap and then opens an empty board
 * teaches a supervisor to stop tapping.
 */

const ICONS: Record<string, React.ReactNode> = {
  blocked: <AlertTriangle className="w-4 h-4" />,
  overdue: <Clock className="w-4 h-4" />,
  due: <AlarmClock className="w-4 h-4" />,
  unassigned: <UserX className="w-4 h-4" />,
  urgent: <Zap className="w-4 h-4" />,
};

const TONE: Record<string, { ring: string; icon: string; value: string }> = {
  urgent: {
    ring: 'border-rose-200 bg-rose-50/60',
    icon: 'text-rose-700',
    value: 'text-rose-900',
  },
  attention: {
    ring: 'border-amber-200 bg-amber-50/60',
    icon: 'text-amber-700',
    value: 'text-amber-900',
  },
  calm: {
    ring: 'border-slate-200 bg-white',
    icon: 'text-slate-500',
    value: 'text-slate-900',
  },
};

export function AttentionRail({
  input,
  loading,
  onOpen,
}: {
  input: AttentionInput;
  loading: boolean;
  onOpen: () => void;
}) {
  const { lang } = useLanguage();
  const items = attentionItems(input, lang);

  return (
    <section aria-label={lang === 'so' ? 'U baahan go’aan' : 'Needs a decision'}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {items.map((item) => {
          const tone = TONE[item.tone];
          const actionable = item.tab !== null && !loading;

          const body = (
            <>
              <div className="flex items-center gap-1.5">
                <span className={tone.icon} aria-hidden="true">
                  {ICONS[item.id]}
                </span>
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 truncate">
                  {item.label}
                </span>
              </div>
              <div
                className={cx(
                  'text-2xl font-extrabold tabular leading-none mt-1.5',
                  loading ? 'text-slate-500' : tone.value,
                )}
              >
                {loading ? '·' : item.value}
              </div>
              <div className="text-[10px] font-semibold text-slate-500 mt-1 leading-tight">
                {item.hint}
              </div>
            </>
          );

          const shared = cx(
            'text-left w-full rounded-2xl border p-3 min-h-[76px]',
            tone.ring,
            actionable && 'hover:shadow-sm hover:border-brand-300 transition cursor-pointer',
          );

          if (!actionable) {
            return (
              <div key={item.id} className={shared}>
                {body}
              </div>
            );
          }

          return (
            <button key={item.id} type="button" onClick={onOpen} className={shared}>
              {body}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A one-line sentence for the rail, for screen readers and for the top of the page. */
export function attentionSentence(input: AttentionInput, lang: 'en' | 'so'): string {
  const so = lang === 'so';
  const problems = [
    { n: input.blocked, en: 'blocked', so: 'xanniban' },
    { n: input.over_sla, en: 'past the promise', so: 'ka baxay ballanta' },
    { n: input.due_today, en: 'due today', so: 'maanta dhammaanaya' },
    { n: input.unassigned, en: 'unassigned', so: 'aan la qorin' },
    { n: input.urgent_open, en: 'urgent', so: 'degdeg' },
  ].filter((item) => item.n > 0);

  if (problems.length === 0) {
    return so ? 'Wax degdeg ah ma jiraan.' : 'Nothing needs a decision.';
  }

  return problems.map((item) => `${item.n} ${item[so ? 'so' : 'en']}`).join(' · ');
}

/** Icon export kept beside the rail so the shell does not import lucide twice. */
export { Truck };
