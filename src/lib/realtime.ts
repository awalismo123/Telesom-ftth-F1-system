import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Push instead of poll.
 *
 * The dispatch board, the live strip and the technician's route used to ask the
 * database "anything new?" every 30–60 seconds. On a phone that is a radio wake
 * every minute for a question whose answer is almost always "no" — and the
 * screen was still up to a minute stale when the answer was "yes".
 *
 * `tasks` is in the `supabase_realtime` publication, so Postgres can tell us.
 * This module wraps that in three habits that matter for a field app:
 *
 *  • **Debounce** — a dispatch of 8 jobs is 8 UPDATEs; the screen refetches once.
 *  • **One channel per hook** — no duplicate subscriptions on re-render.
 *  • **A slow fallback poll** — Realtime can be blocked by a proxy or sleep with
 *    the phone. When the tab is visible and we have not heard anything for a
 *    while, a single quiet refetch keeps the screen honest. Nothing polls while
 *    the tab is hidden.
 */

export interface TableChangeOptions {
  table: string;
  /** PostgREST-style filter, e.g. `group_id=eq.<uuid>` */
  filter?: string;
  enabled?: boolean;
  /** called at most once per debounce window */
  onChange: () => void;
  debounceMs?: number;
}

export function useTableChanges({
  table,
  filter,
  enabled = true,
  onChange,
  debounceMs = 800,
}: TableChangeOptions): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // A background tab cannot show anything; do not spend battery on it.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        handler.current();
      }, debounceMs);
    };

    const channel = supabase
      .channel(`changes:${table}:${filter ?? 'all'}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        fire,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, debounceMs]);
}

/**
 * Run `callback` while the tab is visible, at most every `intervalMs`.
 *
 * Hiding the tab pauses it; showing it again runs the callback immediately (the
 * screen is probably stale by then) and restarts the clock. This replaces every
 * bare `setInterval` in the app, because a hidden tab must not keep a phone's
 * radio awake.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const handler = useRef(callback);
  handler.current = callback;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') handler.current();
      }, intervalMs);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        handler.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
