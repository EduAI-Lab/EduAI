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
import type { PreferenceUpdates } from "~/lib/user-preferences";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { DEFAULT_UI_PREFERENCES, type UiDensity } from "~/lib/ui-preferences";

type UiPreferencesContextValue = {
  motionReduced: boolean;
  density: UiDensity;
  setMotionReduced: (value: boolean) => void;
  setDensity: (value: UiDensity) => void;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function persistPreferencePatch(body: PreferenceUpdates) {
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

/**
 * The OS-level `prefers-reduced-motion` setting, read in an effect rather than
 * during render so the server render and the first client render agree.
 */
function useSystemMotionReduced(): boolean {
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setSystemReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return systemReduced;
}

/**
 * Whether to stop animating: the account preference OR the OS setting.
 *
 * Both signals have to count. Public pages are read by signed-out visitors
 * whose account preference is the `false` default, so honouring only that would
 * leave someone who asked their OS for reduced motion watching the animation
 * anyway (WCAG 2.2.2); and a signed-in reader who set the preference in
 * Settings expects it honoured whatever their OS says.
 *
 * Safe for leaf components in tests — with no provider only the OS half counts.
 */
export function useMotionReducedPreference(): boolean {
  const ctx = useContext(UiPreferencesContext);
  const systemReduced = useSystemMotionReduced();
  return (ctx?.motionReduced ?? false) || systemReduced;
}

export { DEFAULT_UI_PREFERENCES };
