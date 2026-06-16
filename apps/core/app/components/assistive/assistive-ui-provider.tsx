/**
 * App-shell context for the account-level Assistive Mode preference (W3C COGA
 * Objective 8 — adaptation/personalization).
 *
 * The single gating mechanism for assistive UI: when ON, `data-assistive` is
 * present on <html> and `[data-assistive]`-scoped CSS applies; when OFF, the
 * attribute is absent so the page is pixel-identical to baseline.
 *
 * The root loader passes the initial value into this provider; the provider owns
 * the client-side <html> attribute sync and persistence.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type AssistiveUiContextValue = {
  assistive: boolean;
  setAssistive: (value: boolean) => void;
};

const AssistiveUiContext = createContext<AssistiveUiContextValue | null>(null);

export function AssistiveUiProvider({
  initialAssistive,
  children,
}: {
  initialAssistive: boolean;
  children: React.ReactNode;
}) {
  const [assistive, setAssistiveState] = useState(initialAssistive);

  // Keep <html data-assistive> in sync after client-side toggles. The
  // attribute is removed entirely (not set to "false") when OFF so that no
  // [data-assistive] CSS selector can match the baseline state.
  useEffect(() => {
    const el = document.documentElement;
    if (assistive) {
      el.setAttribute("data-assistive", "true");
    } else {
      el.removeAttribute("data-assistive");
    }
  }, [assistive]);

  const setAssistive = useCallback((value: boolean) => {
    setAssistiveState(value);
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ assistDefault: value }),
    }).catch((error) => {
      console.error("Failed to persist assistive preference:", error);
    });
  }, []);

  return (
    <AssistiveUiContext.Provider value={{ assistive, setAssistive }}>
      {children}
    </AssistiveUiContext.Provider>
  );
}

export function useAssistiveUi(): AssistiveUiContextValue {
  const ctx = useContext(AssistiveUiContext);
  if (!ctx) {
    throw new Error("useAssistiveUi must be used within an AssistiveUiProvider");
  }
  return ctx;
}
