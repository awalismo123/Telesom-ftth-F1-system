import { useEffect, useState } from 'react';

/**
 * A clock that ticks while `active` is true.
 *
 * Timers in this app are always recomputed from server timestamps, so this is
 * only a render trigger — the value itself is never accumulated locally.
 */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
