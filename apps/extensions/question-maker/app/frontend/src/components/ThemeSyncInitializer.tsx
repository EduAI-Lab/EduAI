import { useEffect, useRef } from "react";
import { initThemeSync, closeThemeSync, broadcastThemeChange, useTheme } from "@eduai/ui";

/**
 * Initialize cross-app theme synchronization for Question Maker.
 * Must be wrapped in ThemeProvider.
 */
export function ThemeSyncInitializer() {
  const { setTheme, theme } = useTheme();
  // Refs so the init callback sees current theme/setTheme without depending on
  // them. next-themes' `setTheme` is `useCallback(..., [theme])` — NOT stable —
  // so depending on it re-runs the init effect every toggle, re-reads the stale
  // theme cookie, and calls setTheme → infinite "Maximum update depth" loop that
  // flips dark/light. Pin in refs; run init once on mount.
  const themeRef = useRef(theme);
  const setThemeRef = useRef(setTheme);

  useEffect(() => {
    themeRef.current = theme;
    setThemeRef.current = setTheme;
  });

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
    if (theme && (theme === "dark" || theme === "light" || theme === "system")) {
      broadcastThemeChange(theme);
    }
  }, [theme]);

  return null;
}
