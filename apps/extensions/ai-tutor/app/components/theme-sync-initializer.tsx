'use client';

import { useEffect, useRef } from 'react';
import { initThemeSync, closeThemeSync, broadcastThemeChange, useTheme } from '@eduai/ui';

/**
 * Initialize cross-app theme synchronization for AI Tutor.
 * Must be wrapped in ThemeProvider.
 */
export function ThemeSyncInitializer() {
  const { setTheme, theme } = useTheme();
  // Refs so the initThemeSync callback always sees the *current* theme/setTheme
  // without listing them as effect deps. This matters because next-themes'
  // `setTheme` is NOT referentially stable — it is `useCallback(..., [theme])`,
  // so its identity changes on every toggle. Depending on it (or on `theme`)
  // would re-run the init effect each toggle, which re-reads the (stale) theme
  // cookie and calls setTheme → an infinite "Maximum update depth" ping-pong
  // that rapidly flips dark/light. Pinning both in refs lets the effect run
  // exactly once on mount.
  const themeRef = useRef(theme);
  const setThemeRef = useRef(setTheme);

  useEffect(() => {
    themeRef.current = theme;
    setThemeRef.current = setTheme;
  });

  // Initialize cross-app sync exactly once. Empty deps are intentional — see above.
  useEffect(() => {
    initThemeSync((newTheme) => {
      if (newTheme !== themeRef.current) {
        setThemeRef.current(newTheme);
      }
    });

    return () => {
      closeThemeSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Broadcast theme changes to other apps
  useEffect(() => {
    if (theme && (theme === 'dark' || theme === 'light' || theme === 'system')) {
      broadcastThemeChange(theme);
    }
  }, [theme]);

  return null;
}
