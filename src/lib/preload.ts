/**
 * Download a screen's chunk *before* the person taps it.
 *
 * A lazy screen that only starts downloading on tap feels slower than an eager
 * one, even when it is faster. Hovering, focusing or touching the tab is an
 * early, reliable signal of intent, so the chunk is already in the cache by the
 * time the click lands — and the Suspense fallback is rarely seen at all.
 *
 * The map is explicit rather than dynamic (`import(\`./${name}\`)`) so Vite can
 * still analyse it and emit stable chunk names.
 */

const LOADERS = {
  'supervisor-ingest': () => import('../components/supervisor/ingest/IngestWizard'),
  'supervisor-dispatch': () => import('../components/supervisor/dispatch/DispatchBoard'),
  'supervisor-analytics': () => import('../components/supervisor/Analytics'),
  'supervisor-team': () => import('../components/supervisor/TeamAndCrewManager'),
  'supervisor-boxes': () => import('../components/supervisor/BoxRegistry'),
  'tech-route': () => import('../components/technician/RouteView'),
} as const;

export type PreloadKey = keyof typeof LOADERS;

const started = new Set<PreloadKey>();

/** Fire and forget: a failed preload is not an error, the tap will retry. */
export function preload(key: PreloadKey): void {
  if (started.has(key)) return;
  started.add(key);
  void LOADERS[key]().catch(() => {
    // Forget the failure so a later tap can try again on a better connection.
    started.delete(key);
  });
}
