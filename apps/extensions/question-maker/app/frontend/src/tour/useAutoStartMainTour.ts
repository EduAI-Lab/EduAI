import { useEffect, useRef } from 'react';
import { hasSeenMainTour } from './mainTourStorage';

export function useAutoStartMainTour({
  enabled,
  onStart,
}: {
  enabled: boolean;
  onStart: () => void;
}) {
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled || startedRef.current) return;
    if (hasSeenMainTour()) return;

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      onStart();
    };

    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(start, 200);
    return () => window.clearTimeout(t);
  }, [enabled, onStart]);
}
