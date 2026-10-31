import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Sparkles, X } from 'lucide-react';
import { cx } from './cx';

/**
 * The one inline message.
 *
 * Screens used to hand-roll this 22 times, with three different paddings and
 * two different meanings for amber. Tones carry meaning now:
 *
 *   info    — neutral context (sky)
 *   success — it worked (emerald)
 *   warning — needs attention but is not broken (amber)
 *   danger  — it failed (rose)
 *   note    — product/demo context, not an error (violet)
 *
 * `danger` and `warning` announce themselves (`role="alert"`); the others are
 * polite, so a reader is not interrupted by a confirmation.
 */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'note';

const TONES: Record<AlertTone, { wrap: string; icon: string; title: string }> = {
  info: {
    wrap: 'bg-sky-50 border-sky-200 text-sky-900',
    icon: 'text-sky-600',
    title: 'text-sky-950',
  },
  success: {
    wrap: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: 'text-emerald-600',
    title: 'text-emerald-950',
  },
  warning: {
    wrap: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: 'text-amber-600',
    title: 'text-amber-950',
  },
  danger: {
    wrap: 'bg-rose-50 border-rose-200 text-rose-900',
    icon: 'text-rose-600',
    title: 'text-rose-950',
  },
  note: {
    wrap: 'bg-violet-50 border-violet-200 text-violet-900',
    icon: 'text-violet-600',
    title: 'text-violet-950',
  },
};

const ICONS: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
  note: Sparkles,
};

export interface AlertProps {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** a button or link that resolves the message (e.g. Retry) */
  action?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** force or suppress the live-region role */
  live?: 'alert' | 'status' | 'off';
  className?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  live,
  className,
}: AlertProps) {
  const toneMeta = TONES[tone];
  const Icon = ICONS[tone];
  const role = live === 'off' ? undefined : (live ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status'));

  return (
    <div
      role={role}
      className={cx(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed',
        toneMeta.wrap,
        className,
      )}
    >
      <Icon className={cx('w-4 h-4 shrink-0 mt-px', toneMeta.icon)} aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <p className={cx('font-extrabold', toneMeta.title)}>{title}</p>}
        {children && <div className="font-medium">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="shrink-0 -mr-1 -my-1 h-8 w-8 inline-flex items-center justify-center rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
