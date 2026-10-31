import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * "Take me there."
 *
 * Search results and notifications are useless if tapping one only closes the
 * panel. This is the smallest thing that can move a person across shells without
 * adding a router: a named destination, plus the object they asked for.
 *
 * The shells consume an intent and clear it. A `nonce` makes the same
 * destination twice in a row still register (tap the same job again after
 * closing it).
 */

export type NavIntent =
  | { to: 'dispatch'; taskId?: string }
  | { to: 'route'; taskId?: string }
  | { to: 'boxes'; boxId?: string }
  | { to: 'insights' }
  | { to: 'ingest' }
  | { to: 'team' }
  | { to: 'overview' };

export type NavRequest = NavIntent & { nonce: number };

interface NavigationValue {
  intent: NavRequest | null;
  navigate: (intent: NavIntent) => void;
  consume: () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [intent, setIntent] = useState<NavRequest | null>(null);
  const nonce = useRef(0);

  const navigate = useCallback((next: NavIntent) => {
    nonce.current += 1;
    setIntent({ ...next, nonce: nonce.current } as NavRequest);
  }, []);

  const consume = useCallback(() => setIntent(null), []);

  const value = useMemo(() => ({ intent, navigate, consume }), [intent, navigate, consume]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) {
    // A screen rendered outside the provider (tests, storybook) must not crash.
    return { intent: null, navigate: () => undefined, consume: () => undefined };
  }
  return value;
}
