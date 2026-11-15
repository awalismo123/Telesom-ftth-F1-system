import React from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './cx';

/**
 * The one button.
 *
 * Before this, every screen carried its own copy of the padding, radius, hover
 * and disabled classes — and they disagreed. Sizes are also the accessibility
 * contract: `md` and `icon` are 44 px, the minimum a thumb can hit reliably.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
/** `md` and `icon` are 44 px tall/wide — the touch minimum. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-white border border-transparent shadow-sm hover:bg-brand-800 active:bg-brand-900',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-700 border border-transparent hover:bg-slate-100',
  danger:
    'bg-rose-600 text-white border border-transparent shadow-sm hover:bg-rose-700 active:bg-rose-800',
  success:
    'bg-brand-400 text-brand-950 border border-transparent shadow-sm hover:bg-brand-300',
  dark: 'bg-brand-950 text-white border border-brand-950 hover:bg-brand-900',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-xs gap-1.5 rounded-lg',
  md: 'min-h-11 h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'min-h-12 h-12 px-5 text-sm gap-2 rounded-xl',
  icon: 'h-11 w-11 rounded-xl',
  'icon-sm': 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends React.ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-bold transition cursor-pointer select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
