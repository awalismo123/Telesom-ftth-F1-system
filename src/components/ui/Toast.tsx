import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/**
 * Toasts: the app's voice.
 *
 * Every action that changes something says so, and every failure says it in a
 * sentence rather than a Postgres stack trace. Deliberately dependency-free.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  description?: string;
  /** ms; defaults: success 3.5s, info 4s, error 7s */
  duration?: number;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
}

interface ToastApi {
  success: (title: string, options?: ToastOptions) => void;
  error: (title: string, options?: ToastOptions) => void;
  info: (title: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_META: Record<ToastTone, { icon: React.ReactNode; ring: string; iconWrap: string }> = {
  success: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    ring: 'border-emerald-200',
    iconWrap: 'bg-emerald-100 text-emerald-700',
  },
  error: {
    icon: <AlertTriangle className="w-4 h-4" />,
    ring: 'border-rose-200',
    iconWrap: 'bg-rose-100 text-rose-700',
  },
  info: {
    icon: <Info className="w-4 h-4" />,
    ring: 'border-sky-200',
    iconWrap: 'bg-sky-100 text-sky-700',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, options?: ToastOptions) => {
      idRef.current += 1;
      const id = idRef.current;
      const duration =
        options?.duration ?? (tone === 'error' ? 7000 : tone === 'info' ? 4000 : 3500);

      setItems((current) => [
        ...current.slice(-2),
        { id, tone, title, description: options?.description, duration },
      ]);

      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, options) => push('success', title, options),
      error: (title, options) => push('error', title, options),
      info: (title, options) => push('info', title, options),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed z-[80] inset-x-0 bottom-0 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-auto flex flex-col items-stretch sm:items-end gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-4"
      >
        {items.map((item) => {
          const meta = TONE_META[item.tone];
          return (
            <div
              key={item.id}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto w-full sm:w-80 rounded-2xl border bg-white shadow-lg shadow-slate-900/5 px-3 py-2.5 flex items-start gap-2.5 animate-[toast-in_180ms_ease-out] ${meta.ring}`}
            >
              <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${meta.iconWrap}`}>
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold text-slate-900 leading-snug">{item.title}</p>
                {item.description && (
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{item.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="p-1 -m-1 rounded-lg text-slate-300 hover:text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // A component rendered outside the provider must not crash the app.
    return {
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}
