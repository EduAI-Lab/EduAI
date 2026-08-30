/**
 * AI Tutor's motion and density preferences (W3C COGA Objective 8).
 *
 * Parity target: Core's `UiPreferencesProvider`
 * (apps/core/app/components/assistive/ui-preferences-provider.tsx). Same html
 * hooks, same rule that a default value removes its attribute entirely rather
 * than setting `"false"`/`"comfortable"`, so no selector can match the baseline
 * state. The CSS those hooks drive lives in this app's `app/app.css`, ported
 * from Core's.
 *
 * Why this differs from Core:
 * - AI Tutor is a client-only SPA (`ssr: false`, no root `loader`), so there is
 *   no server-resolved initial value to hand the provider on first paint; the
 *   preferences are read from `localStorage` on mount.
 * - AI Tutor has no `/api/preferences` endpoint, so the choice is persisted to
 *   `localStorage` rather than the account DB. Swap this for API-backed
 *   persistence if/when AI Tutor grows one, to sync across devices like Core.
 *
 * Both of those are exactly the trade-offs `assistive-mode.tsx` already makes
 * next door; this file deliberately mirrors it.
 *
 * Before this provider existed, both preferences lived only as attributes that
 * the Settings screen wrote directly to `documentElement` and read back from —
 * so they were inert (no CSS read them) and lost on every reload, while theme
 * and assistive mode persisted. Question Maker's settings page still ships the
 * same two toggles as session-only attribute state and needs the same fix.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { isBrowser } from "@eduai/ui/runtime-env";

const DENSITY_STORAGE_KEY = "eduai:density";
const REDUCE_MOTION_STORAGE_KEY = "eduai:reduce-motion";

export type UiDensity = "comfortable" | "compact";

type UiPreferencesContextValue = {
  density: UiDensity;
  motionReduced: boolean;
  setDensity: (value: UiDensity) => void;
  setMotionReduced: (value: boolean) => void;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function readStored(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing, quota, blocked storage — fall back to the default.
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort only — in-memory state still updates.
  }
}

function readInitialDensity(): UiDensity {
  return readStored(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

function readInitialMotionReduced(): boolean {
  return readStored(REDUCE_MOTION_STORAGE_KEY) === "true";
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<UiDensity>(readInitialDensity);
  const [motionReduced, setMotionReducedState] = useState<boolean>(readInitialMotionReduced);

  useEffect(() => {
    const root = document.documentElement;
    if (density === "compact") {
      root.setAttribute("data-density", "compact");
    } else {
      root.removeAttribute("data-density");
    }
  }, [density]);

  useEffect(() => {
    const root = document.documentElement;
    if (motionReduced) {
      root.setAttribute("data-reduce-motion", "true");
    } else {
      root.removeAttribute("data-reduce-motion");
    }
  }, [motionReduced]);

  const setDensity = (value: UiDensity) => {
    setDensityState(value);
    writeStored(DENSITY_STORAGE_KEY, value);
  };

  const setMotionReduced = (value: boolean) => {
    setMotionReducedState(value);
    writeStored(REDUCE_MOTION_STORAGE_KEY, value ? "true" : "false");
  };

  return (
    <UiPreferencesContext.Provider value={{ density, motionReduced, setDensity, setMotionReduced }}>
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
