/**
 * Stale-while-revalidate, without a data library.
 *
 * Switching tabs on a phone is the most common thing a supervisor does, and
 * every switch used to show a skeleton for a second while the same payload
 * came back from the server. A small in-memory cache fixes the two things that
 * actually hurt:
 *
 *   • the screen paints instantly from the last payload (stale),
 *   • a fresh request still runs and replaces it (revalidate).
 *
 * It is deliberately tiny and explicit: entries are keyed by a string that
 * includes the group and window, they expire, and any mutation can drop them.
 * Nothing is persisted — a reload should never show yesterday's numbers as if
 * they were today's.
 */

interface Entry {
  at: number;
  data: unknown;
}

const store = new Map<string, Entry>();

/** How long a cached payload may be shown before it is treated as absent. */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

export function readCache<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function writeCache<T>(key: string, data: T): void {
  store.set(key, { at: Date.now(), data });
}

/** Drop one key, a prefix (`directory:`), or everything. */
export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) store.delete(key);
  }
}

/** Diagnostics / tests. */
export function cacheSize(): number {
  return store.size;
}

/** Cache keys live here so two screens cannot disagree about the same payload. */
export const cacheKeys = {
  directory: (groupId: string) => `directory:${groupId}`,
  analytics: (groupId: string, days: number) => `analytics:${groupId}:${days}`,
  route: (token: string) => `route:${token}`,
};
