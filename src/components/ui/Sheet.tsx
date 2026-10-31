import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

/**
 * The one modal surface: a bottom sheet on a phone, a centred dialog on a
 * desk. It is a proper dialog, not a div with a backdrop:
 *
 *  • `role="dialog"` + `aria-modal`, labelled by its title;
 *  • focus moves in on open, is trapped while open, and returns on close;
 *  • Escape closes; the backdrop click closes; body scroll is locked;
 *  • the drag handle dismisses on a downward swipe (touch), with the safe-area
 *    inset respected so the action row is never under the home indicator.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const [dragY, setDragY] = React.useState(0);
  const dragStart = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const first = focusables()[0];
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = originalOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const maxWidth = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  const onPointerDown = (event: React.PointerEvent) => {
    dragStart.current = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    const moved = dragY;
    dragStart.current = null;
    setDragY(0);
    if (moved > 96) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={cx(
          'relative w-full bg-white shadow-2xl border border-slate-200 flex flex-col',
          'rounded-t-3xl sm:rounded-3xl max-h-[92dvh] sm:max-h-[85vh]',
          'safe-bottom sm:pb-0',
          maxWidth,
        )}
      >
        {/* Drag handle: touch affordance, and the only way out on a phone
            without hunting for the close button. */}
        <div
          className="pt-2 pb-1 flex justify-center sm:hidden touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        >
          <span className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>

        <div className="px-5 pb-3 pt-2 sm:pt-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-extrabold text-slate-900 leading-tight">
              {title}
            </h2>
            {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 h-11 w-11 -mr-2 -mt-1 inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>

        {footer && <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/60">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
