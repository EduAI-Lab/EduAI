/**
 * Account-level motion and density preferences (W3C COGA Objective 8).
 *
 * Mirrors AssistiveUiProvider: non-default values set html hooks; defaults
 * remove attributes so OFF states stay pixel-identical to baseline.
 *
 * Theme is intentionally NOT owned here. The platform standardises on
 * next-themes (class-based `.dark`, localStorage key `theme`) so that the theme
 * choice carries across the Core, AI Tutor, and Question Maker apps via the
 * shared storage key. Read/write theme through `useTheme` from `@eduai/ui`.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  DEFAULT_UI_PREFERENCES,
  type UiDensity,
} from "~/lib/ui-preferences";

type UiPreferencesContextValue = {
  motionReduced: boolean;
  density: UiDensity;
  setMotionReduced: (value: boolean) => void;
  setDensity: (value: UiDensity) => void;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

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
  children,
}: {
  initialMotionReduced: boolean;
  initialDensity: UiDensity;
  children: React.ReactNode;
}) {
  const [motionReduced, setMotionReducedState] = useState(initialMotionReduced);
  const [density, setDensityState] = useState(initialDensity);

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

  const setMotionReduced = useCallback((value: boolean) => {
    setMotionReducedState(value);
    persistPreferencePatch({ motionReduced: value });
  }, []);

  const setDensity = useCallback((value: UiDensity) => {
    setDensityState(value);
    persistPreferencePatch({ density: value });
  }, []);

  return (
    <UiPreferencesContext.Provider
      value={{
        motionReduced,
        density,
        setMotionReduced,
        setDensity,
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

/** Safe for leaf components in tests — falls back to system preference when no provider. */
export function useMotionReducedPreference(): boolean {
  const ctx = useContext(UiPreferencesContext);
  if (ctx) return ctx.motionReduced;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { DEFAULT_UI_PREFERENCES };
