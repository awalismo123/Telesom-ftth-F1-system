import React, { useCallback, useEffect, useState } from 'react';
import { probeSupabase, type SupabaseProbe } from '../../lib/supabase';
import { ConfigErrorScreen } from './ConfigErrorScreen';

/**
 * Watches the connection without holding the first paint hostage.
 *
 * The children render immediately — a technician should never wait behind a
 * health check on a slow link. Only a *definitive* "the gateway rejects this
 * key" result replaces the app, and only after the built-in key has also been
 * tried. An unreachable server is left to the offline banner and the normal
 * retry paths: that is a network problem, not a broken build.
 */
export function ConfigGate({ children }: { children: React.ReactNode }) {
  const [probe, setProbe] = useState<SupabaseProbe | null>(null);
  const [blocked, setBlocked] = useState(false);

  const check = useCallback(async (force: boolean) => {
    const result = await probeSupabase({ force });
    setProbe(result);
    setBlocked(result.health === 'bad-key');
  }, []);

  useEffect(() => {
    let alive = true;
    void probeSupabase()
      .then((result) => {
        if (!alive) return;
        setProbe(result);
        setBlocked(result.health === 'bad-key');
      })
      .catch(() => {
        // A probe must never break the app it is protecting.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (blocked) {
    return <ConfigErrorScreen probe={probe} onRetry={() => check(true)} />;
  }

  return <>{children}</>;
}
