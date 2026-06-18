'use client';

import { useEffect } from 'react';
import { initThemeSync, closeThemeSync, broadcastThemeChange, useTheme } from '@eduai/ui';

/**
 * Initialize cross-app theme synchronization for AI Tutor.
 * Must be wrapped in ThemeProvider.
 */
export function ThemeSyncInitializer() {
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    // Initialize theme sync with callback to update this app's theme
    initThemeSync((newTheme) => {
      // Only update if the theme is different
      if (newTheme !== theme) {
        setTheme(newTheme);
      }
    });

    return () => {
      closeThemeSync();
    };
  }, [setTheme, theme]);

  // Broadcast theme changes to other apps
  useEffect(() => {
    if (theme && (theme === 'dark' || theme === 'light' || theme === 'system')) {
      broadcastThemeChange(theme);
    }
  }, [theme]);

  return null;
}
