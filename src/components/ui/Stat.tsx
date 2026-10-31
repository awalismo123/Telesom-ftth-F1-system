import React from 'react';
import { cx } from './cx';

/**
 * A number that matters, with the sentence that explains it.
 *
 * The value is the loudest thing in the card and uses tabular figures so two
 * cards side by side do not jitter as they update.
 */
export function Stat({
  label,
  value,
  icon,
  hint,
  tone = 'emerald',
  onClick,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'emerald' | 'sky' | 'amber' | 'violet';
  onClick?: () => void;
  className?: string;
}) {
  const tones = {
    emerald: 'text-emerald-600',
    sky: 'text-sky-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
  } as const;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        {icon && (
          <span aria-hidden="true" className={tones[tone]}>
            {icon}
          </span>
        )}
      </div>
      <div className="text-2xl font-extrabold text-slate-900 tabular leading-none">{value}</div>
      {hint && <div className={cx('text-[11px] font-semibold mt-1.5', tones[tone])}>{hint}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'text-left w-full rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs',
          'hover:border-emerald-300 hover:shadow-sm transition cursor-pointer',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={cx('rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs', className)}>
      {body}
    </div>
  );
}
