import React from 'react';
import { cx } from './cx';

/**
 * Status colour is a language, not decoration: emerald = healthy/done,
 * amber = attention, rose = problem, sky = informational, slate = neutral.
 */

export type BadgeTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' | 'violet';

const TONES: Record<BadgeTone, string> = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-900 border-amber-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  sky: 'bg-sky-100 text-sky-800 border-sky-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200',
};

export interface BadgeProps extends React.ComponentPropsWithRef<'span'> {
  tone?: BadgeTone;
  /** solid badges are for the active state of a control */
  solid?: boolean;
  /** a leading dot, for live/health indicators */
  dot?: boolean;
}

export function Badge({ tone = 'slate', solid = false, dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide whitespace-nowrap',
        solid ? 'bg-emerald-400 text-emerald-950 border-emerald-300' : TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cx(
            'w-1.5 h-1.5 rounded-full',
            tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'rose' ? 'bg-rose-500' : 'bg-slate-400',
          )}
        />
      )}
      {children}
    </span>
  );
}
