import { useEffect, useState } from 'react';

/**
 * Delay a value until it stops changing.
 *
 * A search box that filters a few dozen client-side rows does not need this;
 * one that will eventually query the server does, and typing on a phone
 * keyboard is bursty. `delayMs` is short enough to feel instant.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
