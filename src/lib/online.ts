import { useEffect, useState } from 'react';

/**
 * Connectivity, as the phone understands it. `navigator.onLine` is a guess,
 * so the hook also exposes a probe for the moment an action fails anyway.
 */

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => isOnline());

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // The events can be missed while a tab sleeps — re-check on focus.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setOnline(isOnline());
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return online;
}
