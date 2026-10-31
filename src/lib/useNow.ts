import { useEffect, useState } from 'react';

/**
 * A clock that ticks while `active` is true.
 *
 * Timers in this app are always recomputed from server timestamps, so this is
 * only a render trigger — the value itself is never accumulated locally.
 *
 * It also stops while the tab is hidden. A phone in a pocket should not wake
 * its CPU once a second to repaint a number nobody can see; the first tick
 * after the tab returns catches the clock up, because the value comes from the
 * server timestamps rather than from counting.
 */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id) return;
      id = setInterval(() => setNow(Date.now()), intervalMs);
    };

    const stop = () => {
      if (!id) return;
      clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
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
  }, [active, intervalMs]);

  return now;
}
