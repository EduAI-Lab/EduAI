/**
 * AI Tutor's minimal Assistive Mode plumbing.
 *
 * Parity target: Core's `AssistiveUiProvider`
 * (apps/core/app/components/assistive/assistive-ui-provider.tsx). Same gating
 * mechanism: `data-assistive` on `<html>` is the *only* hook — present when ON,
 * absent (never `"false"`) when OFF — so `[data-assistive] .reading-surface`
 * CSS can apply. This file never defines or edits that CSS; see
 * eduai-design-system for the BREB-approved contract, which must not change.
 *
 * Why this differs from Core:
 * - AI Tutor is a client-only SPA (`ssr: false`, no root `loader`), so there is
 *   no server-resolved `initialAssistive` to hand the provider on first paint.
 *   The preference is read from `localStorage` on mount instead.
 * - AI Tutor has no `/api/preferences` (or any account-preferences) endpoint,
 *   and adding backend/API surface is out of scope here. The preference is
 *   persisted to `localStorage` rather than the account DB. Swap this for a
 *   real API-backed persistence layer if/when AI Tutor grows one, to sync the
 *   preference across devices like Core does.
 *
 * Reading-treatment CSS: `[data-assistive] .reading-surface` and its
 * `--assistive-*` tokens are shared via `@eduai/ui`
 * (packages/ui/src/styles/assistive-reading.css), which this app's
 * `app/app.css` imports. Toggling this preference sets/clears the attribute,
 * persists the choice, and applies the reading treatment to any content here
 * marked `reading-surface`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ASSISTIVE_STORAGE_KEY = 'eduai:assistive';

type AssistiveModeContextValue = {
  assistive: boolean;
  setAssistive: (value: boolean) => void;
};

const AssistiveModeContext = createContext<AssistiveModeContextValue | null>(null);

function readInitialAssistive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ASSISTIVE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AssistiveModeProvider({ children }: { children: ReactNode }) {
  const [assistive, setAssistiveState] = useState(readInitialAssistive);

  // Keep <html data-assistive> in sync. The attribute is removed entirely
  // (not set to "false") when OFF so no [data-assistive] CSS selector can
  // match the baseline state — mirrors Core exactly.
  useEffect(() => {
    const el = document.documentElement;
    if (assistive) {
      el.setAttribute('data-assistive', 'true');
    } else {
      el.removeAttribute('data-assistive');
    }
  }, [assistive]);

  const setAssistive = (value: boolean) => {
    setAssistiveState(value);
    try {
      window.localStorage.setItem(ASSISTIVE_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      // Best-effort only (private browsing, quota, etc.) — state still updates.
    }
  };

  return (
    <AssistiveModeContext.Provider value={{ assistive, setAssistive }}>
      {children}
    </AssistiveModeContext.Provider>
  );
}

export function useAssistiveMode(): AssistiveModeContextValue {
  const ctx = useContext(AssistiveModeContext);
  if (!ctx) {
    throw new Error('useAssistiveMode must be used within an AssistiveModeProvider');
  }
  return ctx;
}
