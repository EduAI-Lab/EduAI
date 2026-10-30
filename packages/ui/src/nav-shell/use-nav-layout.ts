import * as React from "react";

export type NavBreakpoint = "mobile" | "tablet" | "desktop";

const TABLET_QUERY = "(min-width: 768px)";
const DESKTOP_QUERY = "(min-width: 1024px)";

export const RAIL_COLLAPSED_KEY = "eduai.nav.railCollapsed";
export const COURSE_MENU_OPEN_KEY = "eduai.nav.courseMenuOpen";

/** Client-only: called from effects, never during render. */
function readBreakpoint(): NavBreakpoint {
  if (!window.matchMedia) return "desktop";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

/**
 * The current layout breakpoint. The server and the first client render both
 * report "desktop" so hydration matches; the visible chrome for each size is
 * switched by CSS (`md:` / `lg:`), so this value only drives behaviour — which
 * drawer the hamburger opens, whether tooltips are needed — not first paint.
 */
export function useNavBreakpoint(): NavBreakpoint {
  const [breakpoint, setBreakpoint] = React.useState<NavBreakpoint>("desktop");

  React.useEffect(() => {
    if (!window.matchMedia) return;
    const sync = () => setBreakpoint(readBreakpoint());
    sync();
    const queries = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)];
    for (const query of queries) query.addEventListener?.("change", sync);
    return () => {
      for (const query of queries) query.removeEventListener?.("change", sync);
    };
  }, []);

  return breakpoint;
}

/**
 * A boolean kept in localStorage. Storage can be missing or throw (private
 * windows, blocked site data), so every access is guarded and the default
 * stands in; the stored value is only read after mount for the same hydration
 * reason as the breakpoint above.
 */
export function usePersistedFlag(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = React.useState(defaultValue);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "true" || stored === "false") setValue(stored === "true");
    } catch {
      // Storage unavailable: keep the default.
    }
  }, [key]);

  const update = React.useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
    },
    [key],
  );

  return [value, update];
}
