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
 * This module wraps that in four habits that matter for a field app:
 *
 *  • **A unique topic per subscription** — see `tableChannelTopic` below. This
 *    is not cosmetic; sharing a topic crashed the dispatch tab.
 *  • **Debounce** — a dispatch of 8 jobs is 8 UPDATEs; the screen refetches once.
 *  • **Never throw** — a subscription failure leaves the screen working on the
 *    slow fallback poll instead of blanking it.
 *  • **A slow fallback poll** — Realtime can be blocked by a proxy or sleep with
 *    the phone. When the tab is visible and we have not heard anything for a
 *    while, a single quiet refetch keeps the screen honest. Nothing polls while
 *    the tab is hidden.
 *
 * Since Batch B the feed carries **no row data**. `postgres_changes` obeys
 * row-level security, and the tables now have no anonymous read policy — the
 * old feed would either leak rows or deliver nothing. A trigger publishes
 * `{ table }` on a broadcast channel instead; hearing it means "refetch through
 * your token-checked function", which is where the data is actually authorised.
 */

/**
 * The realtime client, reduced to the two calls this module makes.
 *
 * Narrowing it to a structural type keeps the subscription logic testable with
 * a fake client — the collision below is a library contract, and it deserves a
 * test that does not need a live socket.
 */
export interface ChangeSignal {
  table?: string;
}

export interface RealtimeChannelLike {
  on(
    event: 'broadcast',
    config: { event: string },
    callback: (message: { payload?: ChangeSignal }) => void,
  ): RealtimeChannelLike;
  subscribe(): RealtimeChannelLike;
}

export interface RealtimeClientLike {
  channel(topic: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
}

let topicCounter = 0;

/**
 * A channel name that is unique to one subscription.
 *
 * supabase-js de-duplicates `channel(topic)` **by topic**: asking for a topic
 * that already exists returns the existing channel object. If that channel is
 * already subscribed, the next `.on('postgres_changes', …)` throws
 * `cannot add postgres_changes callbacks … after subscribe()` — and the throw
 * happens inside an effect, so React replaces the screen with the error card.
 *
 * The dispatch tab had exactly that: `DispatchBoard` and `LiveStrip` both watch
 * `tasks` filtered by the same group id, so the second one always collided. It
 * was worse than a crash: whichever unmounted first called `removeChannel` on
 * the *shared* channel and silently killed the other's stream.
 *
 * A counter makes every subscription its own channel. Channels are cheap — they
 * multiplex over one socket — and an isolated channel cannot be torn down by a
 * neighbour.
 */
export function tableChannelTopic(table: string, filter?: string): string {
  topicCounter += 1;
  const scope = (filter ?? 'all').replace(/=eq\./g, '=');
  return `f1:${table}:${scope}:${topicCounter}`;
}

export interface TableSubscription {
  topic: string;
  unsubscribe: () => void;
}

/** The one broadcast channel the database trigger publishes on. */
export const CHANGE_TOPIC = 'f1:changes';
export const CHANGE_EVENT = 'change';

/**
 * One broadcast channel, many subscribers.
 *
 * `client.channel(name)` de-duplicates by name: asking twice returns the same
 * object, and adding a callback after `subscribe()` throws. The old feed dodged
 * that by giving every subscriber a unique channel name — which worked because
 * each name was its own Postgres filter.
 *
 * A broadcast topic cannot work that way: the channel name *is* the topic. So
 * the module keeps one channel per topic and fans the signal out to everyone
 * who asked. That is also less work for the phone: one socket subscription
 * instead of one per screen.
 */
type SignalHandler = (signal: ChangeSignal) => void;

interface SharedChannel {
  channel: RealtimeChannelLike;
  handlers: Set<SignalHandler>;
}

const sharedChannels = new WeakMap<RealtimeClientLike, Map<string, SharedChannel>>();

function channelRegistry(client: RealtimeClientLike): Map<string, SharedChannel> {
  let registry = sharedChannels.get(client);
  if (!registry) {
    registry = new Map();
    sharedChannels.set(client, registry);
  }
  return registry;
}

/**
 * Subscribe to a table, safely.
 *
 * Returns `null` when the subscription could not be created. The caller keeps
 * its fallback poll, so the screen is slower but correct — never blank.
 */
export function subscribeTableChanges(
  client: RealtimeClientLike,
  {
    table,
    filter,
    onChange,
  }: {
    table: string;
    filter?: string;
    onChange: () => void;
  },
): TableSubscription | null {
  const topic = tableChannelTopic(table, filter);
  const registry = channelRegistry(client);
  const existing = registry.get(CHANGE_TOPIC);

  const handler: SignalHandler = (signal) => {
    // The payload names the table and nothing else. A signal for another table
    // is not this screen's business.
    if (signal?.table && signal.table !== table) return;
    onChange();
  };

  if (existing) {
    existing.handlers.add(handler);
    return { topic, unsubscribe: () => release(client, existing, handler) };
  }

  try {
    const shared: SharedChannel = {
      channel: undefined as unknown as RealtimeChannelLike,
      handlers: new Set([handler]),
    };

    shared.channel = client
      .channel(CHANGE_TOPIC)
      .on('broadcast', { event: CHANGE_EVENT }, (message) => {
        for (const current of shared.handlers) current(message?.payload ?? {});
      })
      .subscribe();

    registry.set(CHANGE_TOPIC, shared);

    return { topic, unsubscribe: () => release(client, shared, handler) };
  } catch (error) {
    // A live feed is an optimisation; it must never be a single point of
    // failure for a screen a technician is standing in front of.
    console.warn('[Telesom F1] realtime unavailable, falling back to polling:', error);
    registry.delete(CHANGE_TOPIC);
    return null;
  }
}

function release(client: RealtimeClientLike, shared: SharedChannel, handler: SignalHandler): void {
  shared.handlers.delete(handler);
  if (shared.handlers.size > 0) return;

  // The last screen watching has gone: close the socket subscription.
  const registry = channelRegistry(client);
  if (registry.get(CHANGE_TOPIC) === shared) registry.delete(CHANGE_TOPIC);

  try {
    void client.removeChannel(shared.channel);
  } catch {
    // Already gone, or the socket was never opened. Nothing to clean up.
  }
}

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

    const subscription = subscribeTableChanges(supabase as unknown as RealtimeClientLike, {
      table,
      filter,
      onChange: fire,
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription?.unsubscribe();
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
export function useVisibleInterval(callback: () => void, intervalMs: number, enabled = true): void {
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
