import { useSyncExternalStore } from "react";
import { UBC_TIME_ZONE } from "@eduai/ui/term";

/** Locale and time zone to hand to `toLocaleString`/`Intl.DateTimeFormat`. */
export type FormatScope = {
  locale: string | undefined;
  timeZone: string | undefined;
};

/**
 * What the server and the hydrating client both format with (#1941).
 *
 * Prod renders in UTC with Node's default locale, while the browser runs in the
 * user's own zone and locale. A date formatted with either default comes out
 * differently on each side, React reports a hydration mismatch, and with no
 * Suspense boundary above it React re-renders the whole document from scratch.
 * That swap discards whatever the user typed or clicked before hydration
 * finished. Pinning both sides to one locale and UBC's zone keeps the markup
 * identical, and that zone is already where nearly every user is.
 */
export const SERVER_FORMAT_SCOPE: FormatScope = { locale: "en-US", timeZone: UBC_TIME_ZONE };

/** `undefined` lets the browser use its own locale and zone. */
const BROWSER_FORMAT_SCOPE: FormatScope = { locale: undefined, timeZone: undefined };

const subscribeNever = () => () => {};

/**
 * Format scope for dates rendered during SSR. Gives {@link SERVER_FORMAT_SCOPE}
 * on the server and during hydration, then the browser's own locale and zone
 * from the next render on, so users still see their local time.
 */
export function useFormatScope(): FormatScope {
  return useSyncExternalStore(
    subscribeNever,
    () => BROWSER_FORMAT_SCOPE,
    () => SERVER_FORMAT_SCOPE,
  );
}
