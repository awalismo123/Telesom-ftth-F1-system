import React, { useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useLanguageSafe } from '../../lib/i18n';
import { cx } from './cx';

/**
 * A tip, shown once per person per screen.
 *
 * A field system is learned in the first five minutes or not at all — nobody
 * reads a manual while holding a ladder. These hints exist to answer the one
 * question each screen raises the first time ("what do I do here?") and then get
 * out of the way for good.
 *
 * Stored per user id, so a shared phone does not re-teach the supervisor's tips
 * to a technician, and a new person on the same device does get them.
 */

const storageKey = (id: string, userId: string) => `telesom_f1_hint_${userId}_${id}`;

export interface FirstRunHintProps {
  /** stable id per hint, e.g. 'dispatch-pool' */
  id: string;
  title: string;
  children: React.ReactNode;
  /** the person seeing it; nothing is stored without one */
  userId?: string | null;
  className?: string;
}

export function FirstRunHint({ id, title, children, userId, className }: FirstRunHintProps) {
  // Declared first: an early return above a hook call is the classic way to
  // crash React with "rendered fewer hooks than expected".
  const i18n = useLanguageSafe();
  const dismissLabel = i18n?.lang === 'so' ? 'Waad mahadsantahay' : 'Got it';

  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === 'undefined' || !userId) return false;
    try {
      return localStorage.getItem(storageKey(id, userId)) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      if (userId) localStorage.setItem(storageKey(id, userId), '1');
    } catch {
      // Private mode: the hint comes back next visit. Not worth an error.
    }
  };

  if (dismissed) return null;

  return (
    <div
      className={cx(
        'rounded-2xl border border-sky-200 bg-sky-50/80 px-3.5 py-3 text-sky-950 print-block',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold">{title}</p>
          <div className="mt-0.5 text-[11px] leading-relaxed text-sky-900/90">{children}</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={dismissLabel}
          className="shrink-0 p-1 -m-1 rounded-lg text-sky-700/70 hover:text-sky-900 hover:bg-sky-100 transition cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
