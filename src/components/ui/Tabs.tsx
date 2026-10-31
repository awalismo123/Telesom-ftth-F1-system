import React from 'react';
import { cx } from './cx';

/**
 * One tab strip for the whole app, in two shapes:
 *
 *  • `pills` — scrollable module navigation (supervisor, on any width)
 *  • `bar`   — a compact segmented control for tablet/desktop
 *
 * Implements the ARIA tabs pattern properly: roving tabindex, arrow keys,
 * Home/End, and `aria-selected` — a keyboard user can reach any module without
 * tabbing through every button.
 */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: 'pills' | 'bar';
  label: string;
  className?: string;
  /** fired on hover / focus of a tab — used to prefetch its chunk */
  onIntent?: (id: T) => void;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  variant = 'pills',
  label,
  className,
  onIntent,
}: TabsProps<T>) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const target = buttons?.[index];
    if (target) {
      target.focus();
      onChange(items[index].id);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = items.length - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusTab(index === last ? 0 : index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusTab(index === 0 ? last : index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(last);
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cx(
        'flex items-center gap-1.5',
        variant === 'pills' ? 'overflow-x-auto pb-1 -mx-1 px-1' : 'bg-slate-100 p-1 rounded-xl',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onPointerEnter={() => onIntent?.(item.id)}
            onFocus={() => onIntent?.(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition cursor-pointer',
              variant === 'pills'
                ? 'min-h-11 px-4 rounded-xl text-xs border'
                : 'flex-1 min-h-9 px-3 rounded-lg text-xs',
              variant === 'pills'
                ? active
                  ? 'bg-emerald-950 text-white border-emerald-950 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50/60 hover:border-emerald-200'
                : active
                  ? 'bg-white text-emerald-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
            {item.badge != null && (
              <span
                className={cx(
                  'text-[10px] font-extrabold px-1.5 py-0.5 rounded-md',
                  active
                    ? 'bg-emerald-400 text-emerald-950'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
