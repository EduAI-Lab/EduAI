/**
 * Account-level motion, density, and theme preferences (W3C COGA Objective 8).
 *
 * Mirrors AssistiveUiProvider: non-default values set html hooks; defaults
 * remove attributes/classes so OFF states stay pixel-identical to baseline.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  DEFAULT_UI_PREFERENCES,
  type UiDensity,
  type UiTheme,
} from "~/lib/ui-preferences";

type UiPreferencesContextValue = {
  motionReduced: boolean;
  density: UiDensity;
  theme: UiTheme;
  setMotionReduced: (value: boolean) => void;
  setDensity: (value: UiDensity) => void;
  setTheme: (value: UiTheme) => void;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function applyThemeClass(theme: UiTheme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    return;
  }

  root.classList.add(theme);
}

function persistPreferencePatch(body: Record<string, unknown>) {
  fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  }).catch((error) => {
    console.error("Failed to persist UI preference:", error);
  });
}

export function UiPreferencesProvider({
  initialMotionReduced,
  initialDensity,
  initialTheme,
  children,
}: {
  initialMotionReduced: boolean;
  initialDensity: UiDensity;
  initialTheme: UiTheme;
  children: React.ReactNode;
}) {
  const [motionReduced, setMotionReducedState] = useState(initialMotionReduced);
  const [density, setDensityState] = useState(initialDensity);
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (motionReduced) {
      root.setAttribute("data-reduce-motion", "true");
    } else {
      root.removeAttribute("data-reduce-motion");
    }
  }, [motionReduced]);

  useEffect(() => {
    const root = document.documentElement;
    if (density === "compact") {
      root.setAttribute("data-density", "compact");
    } else {
      root.removeAttribute("data-density");
    }
  }, [density]);

  useEffect(() => {
    applyThemeClass(theme);

    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeClass("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setMotionReduced = useCallback((value: boolean) => {
    setMotionReducedState(value);
    persistPreferencePatch({ motionReduced: value });
  }, []);

  const setDensity = useCallback((value: UiDensity) => {
    setDensityState(value);
    persistPreferencePatch({ density: value });
  }, []);

  const setTheme = useCallback((value: UiTheme) => {
    setThemeState(value);
    persistPreferencePatch({ theme: value });
  }, []);

  return (
    <UiPreferencesContext.Provider
      value={{
        motionReduced,
        density,
        theme,
        setMotionReduced,
        setDensity,
        setTheme,
      }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextValue {
  const ctx = useContext(UiPreferencesContext);
  if (!ctx) {
    throw new Error("useUiPreferences must be used within a UiPreferencesProvider");
  }
  return ctx;
}

export { DEFAULT_UI_PREFERENCES };
