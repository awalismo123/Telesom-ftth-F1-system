import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { useOnline } from '../../lib/online';

/**
 * A quiet strip that tells the truth about connectivity, and then gets out of
 * the way as soon as the signal is back.
 */
export function OfflineBanner() {
  const online = useOnline();
  const { lang } = useLanguage();
  const so = lang === 'so';
  const [wasOffline, setWasOffline] = useState(false);
  const [justBack, setJustBack] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setJustBack(false);
      return;
    }
    if (wasOffline) {
      setJustBack(true);
      const timer = window.setTimeout(() => {
        setJustBack(false);
        setWasOffline(false);
      }, 2600);
      return () => window.clearTimeout(timer);
    }
  }, [online, wasOffline]);

  if (online && !justBack) return null;

  if (online) {
    return (
      <div className="sticky top-0 z-40 bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 text-center">
        {so ? 'Xiriirka wuu soo noqday — isku day mar kale.' : 'Back online — you can continue.'}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 bg-amber-500 text-amber-950 text-[11px] font-bold px-3 py-1.5 flex items-center justify-center gap-1.5"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        {so
          ? 'Xiriir ma jiro — waxba lama kaydin karo ilaa signal-ku soo noqdo.'
          : 'No connection — changes cannot be saved until the signal returns.'}
      </span>
    </div>
  );
}
