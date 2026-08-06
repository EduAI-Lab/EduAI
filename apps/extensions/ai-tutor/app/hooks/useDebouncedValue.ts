import { useEffect, useState } from 'react';

/** Default settle time for search-as-you-type. */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Track `value`, but only surface it once it has stopped changing for `delayMs`.
 *
 * Why (#1208): the course surfaces now search server-side, so every keystroke
 * would otherwise be a request. Debouncing collapses a burst of typing into one
 * call and keeps responses arriving roughly in order.
 *
 * The timer resets on every change, so a fast typist triggers exactly one update
 * after they pause. Changing `delayMs` mid-flight restarts the pending timer
 * rather than applying the old delay.
 *
 * NB: this only delays the *value*. Callers firing requests off the debounced
 * value must still guard against out-of-order responses — debouncing narrows
 * that window, it does not close it.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
