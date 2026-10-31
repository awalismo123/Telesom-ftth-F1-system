import React from 'react';
import { cx } from './cx';

/**
 * Form controls with the label, hint and error wired to the input by id, so a
 * screen reader announces "PIN, 4 to 6 digits" instead of "edit text".
 *
 * `Input` keeps a 16 px font size at all times: anything smaller makes iOS zoom
 * the viewport on focus, which used to break the login screen on a phone.
 */

const CONTROL =
  'w-full rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 transition ' +
  'focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:bg-slate-50 disabled:text-slate-500';

const OK = 'border-slate-300 focus:border-emerald-600 focus:ring-emerald-600/25';
const BAD = 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/25';

interface FieldShell {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  /** right-aligned note next to the label (e.g. "4–6 digits") */
  aside?: React.ReactNode;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  aside,
  children,
}: FieldShell & { id: string; children: React.ReactNode }) {
  return (
    <div>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          {label && (
            <label htmlFor={id} className="block text-xs font-bold text-slate-700">
              {label}
            </label>
          )}
          {aside && <span className="text-[11px] font-medium text-slate-400">{aside}</span>}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[11px] font-semibold text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[11px] text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.ComponentPropsWithRef<'input'>, FieldShell {
  /** visual size only — the font stays ≥16 px for mobile browsers */
  inputSize?: 'md' | 'lg';
}

export function Input({ label, hint, error, aside, id, className, inputSize = 'md', ...rest }: InputProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  return (
    <FieldShell id={controlId} label={label} hint={hint} error={error} aside={aside}>
      <input
        {...rest}
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${controlId}-error` : hint ? `${controlId}-hint` : undefined}
        className={cx(
          CONTROL,
          error ? BAD : OK,
          inputSize === 'lg' ? 'h-12 px-4 text-base' : 'h-11 px-3.5 text-base',
          className,
        )}
      />
    </FieldShell>
  );
}

export interface SelectProps extends React.ComponentPropsWithRef<'select'>, FieldShell {}

export function Select({ label, hint, error, aside, id, className, children, ...rest }: SelectProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  return (
    <FieldShell id={controlId} label={label} hint={hint} error={error} aside={aside}>
      <select
        {...rest}
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${controlId}-error` : hint ? `${controlId}-hint` : undefined}
        className={cx(CONTROL, error ? BAD : OK, 'h-11 px-3 text-sm font-semibold', className)}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export interface TextareaProps extends React.ComponentPropsWithRef<'textarea'>, FieldShell {}

export function Textarea({ label, hint, error, aside, id, className, ...rest }: TextareaProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  return (
    <FieldShell id={controlId} label={label} hint={hint} error={error} aside={aside}>
      <textarea
        {...rest}
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${controlId}-error` : hint ? `${controlId}-hint` : undefined}
        className={cx(CONTROL, error ? BAD : OK, 'min-h-24 p-3 text-base leading-relaxed', className)}
      />
    </FieldShell>
  );
}
