import React from 'react';
import { cx } from './cx';

/**
 * The surface every screen composes. `Card` is deliberately plain: a border, a
 * radius, a shadow token. Anything more opinionated belongs to the screen.
 */

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
} as const;

export type CardPadding = keyof typeof PADDING;

export interface CardProps extends React.ComponentPropsWithRef<'div'> {
  padding?: CardPadding;
  /** raised surfaces sit on white; flat ones on a tinted page */
  tone?: 'default' | 'muted' | 'dark';
}

export function Card({ padding = 'md', tone = 'default', className, children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cx(
        'rounded-2xl border shadow-xs',
        tone === 'default' && 'bg-white border-slate-200',
        tone === 'muted' && 'bg-slate-50 border-slate-200',
        tone === 'dark' && 'bg-emerald-950 border-emerald-800/60 text-white',
        PADDING[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-slate-900 leading-tight truncate">{title}</h3>
          {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
