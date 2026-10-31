import React from 'react';
import { cx } from './cx';

/**
 * "Nothing here" is information, not a failure. Every list in the app should
 * say *why* it is empty and what to do next, in the language of the screen.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'default',
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'dark';
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center rounded-2xl border border-dashed px-6 py-10',
        tone === 'default' ? 'border-slate-300 bg-slate-50/60' : 'border-emerald-800/60 bg-emerald-900/20',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cx(
            'w-11 h-11 rounded-2xl flex items-center justify-center mb-3',
            tone === 'default' ? 'bg-white text-slate-400 border border-slate-200' : 'bg-emerald-400/15 text-emerald-300',
          )}
        >
          {icon}
        </div>
      )}
      <p className={cx('text-sm font-extrabold', tone === 'default' ? 'text-slate-800' : 'text-white')}>
        {title}
      </p>
      {description && (
        <p className={cx('text-xs mt-1 max-w-sm', tone === 'default' ? 'text-slate-500' : 'text-emerald-200/80')}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
