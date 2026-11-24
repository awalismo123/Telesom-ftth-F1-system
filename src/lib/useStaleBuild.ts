import { useEffect, useState } from 'react';
import { APP_VERSION } from './version';

/**
 * Is the tab in front of the user older than the build on the server?
 *
 * ## Why this exists
 *
 * A deployed change is invisible to anyone who already had the app open. The
 * browser keeps the loaded JavaScript — there is no service worker here to make
 * it worse, but there is also nothing to make it better, and a supervisor who
 * has had the dispatch page open since this morning will keep using this
 * morning's build all day.
 *
 * That is what "I did not see the changes" usually means. It is not a deploy
 * failure, and asking the user to hard-refresh does not help the next person.
 *
 * ## How it decides
 *
 * The deployed `index.html` names the version it was built from in a meta tag.
 * Fetching that file is cheap, uncached (it is the one file Vercel does not
 * fingerprint), and enough to compare. A difference means the server has moved
 * on; the tab should say so rather than silently serve yesterday's code.
 *
 * It never reloads on its own. A technician halfway through a job, with a timer
 * running and a photo about to upload, must not have the page taken out from
 * under them — the reload is offered, not taken.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface StaleBuild {
  /** The version the server is serving now. */
  serverVersion: string;
  /** Reload onto it. */
  reload: () => void;
  /** Hide the notice until the next page load. */
  dismiss: () => void;
}

export function useStaleBuildNotice(): StaleBuild | null {
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;

    const check = async () => {
      try {
        /**
         * `cache: 'no-store'` is the point of the request.
         *
         * Without it the browser may answer from its own copy of `index.html`,
         * which would report the version already running and always look
         * up to date.
         */
        const response = await fetch('/index.html', { cache: 'no-store' });
        if (!response.ok) return;

        const html = await response.text();
        const found = /<meta\s+name="app-version"\s+content="([^"]+)"/i.exec(html)?.[1] ?? null;

        if (!live || !found) return;
        // Only a *different* version is news. A missing meta tag (a dev build,
        // an older deploy) must not produce a notice about nothing.
        if (found !== APP_VERSION) setServerVersion(found);
        else setServerVersion(null);
      } catch {
        // Offline, or the network dropped. Nothing to say about a version the
        // app could not read; the next tick will try again.
      }
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);

    /**
     * A tab brought back into focus is the moment to check.
     *
     * A phone that was in a pocket for three hours is exactly when the running
     * build is most likely to be old, and checking on focus means the notice
     * appears when the person looks rather than up to five minutes later.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!serverVersion || dismissed) return null;

  return {
    serverVersion,
    reload: () => window.location.reload(),
    dismiss: () => setDismissed(true),
  };
}
