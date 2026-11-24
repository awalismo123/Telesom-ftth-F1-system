import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { useStaleBuildNotice } from '../../lib/useStaleBuild';
import { APP_VERSION } from '../../lib/version';

/**
 * A quiet bar saying a newer build exists.
 *
 * It is deliberately not a modal and it does not reload by itself. Two people
 * this must never interrupt: a technician with a timer running and a photo
 * halfway uploaded, and a supervisor composing a message to a crew. So the
 * notice sits at the top, says which version is running and which is waiting,
 * and lets them choose the moment.
 *
 * If they close it, it stays closed until the next page load. Nothing is more
 * annoying than a banner that returns every five minutes.
 */
export function StaleBuildNotice() {
  const { lang } = useLanguage();
  const so = lang === 'so';
  const stale = useStaleBuildNotice();

  if (!stale) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[70] px-3 pt-3"
    >
      <div className="mx-auto max-w-3xl rounded-2xl bg-slate-900 text-white shadow-lg px-3 py-2.5 flex items-center gap-2.5">
        <RefreshCw className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold leading-tight">
            {so ? 'Nooc cusub ayaa diyaar ah' : 'A newer version is ready'}
          </p>
          <p className="text-[10px] text-slate-200 leading-snug tabular">
            {so
              ? `Waxaad isticmaalaysaa ${APP_VERSION} · cusubi waa ${stale.serverVersion}`
              : `You are on ${APP_VERSION} · the server has ${stale.serverVersion}`}
          </p>
        </div>

        <button
          type="button"
          onClick={stale.reload}
          className="shrink-0 min-h-11 px-3 rounded-xl bg-white text-slate-900 text-[11px] font-extrabold hover:bg-slate-100 transition cursor-pointer"
        >
          {so ? 'Cusboonaysii' : 'Reload'}
        </button>

        <button
          type="button"
          onClick={stale.dismiss}
          aria-label={so ? 'Xir' : 'Dismiss'}
          className="shrink-0 inline-flex items-center justify-center w-11 min-h-11 rounded-xl text-slate-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
