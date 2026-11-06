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

// Formatters for anything that may render during SSR. Each one takes the scope
// from `useFormatScope` and always passes its `timeZone`, so a call site cannot
// silently fall back to the runtime default. To keep a fixed locale (e.g. the
// "en-CA" date style), spread the scope: `{ ...scope, locale: "en-CA" }`.

type DateInput = string | number | Date;

export function formatDate(
  value: DateInput,
  { locale, timeZone }: FormatScope,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString(locale, { ...options, timeZone });
}

export function formatDateTime(
  value: DateInput,
  { locale, timeZone }: FormatScope,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleString(locale, { ...options, timeZone });
}

export function formatNumber(
  value: number,
  { locale }: FormatScope,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(locale, options);
}

/**
 * "Just now" / "5m ago" / "3h ago" / "Yesterday" / "3 days ago", then a short
 * date in the scope's zone. The relative buckets read the wall clock, which the
 * server and browser can see on either side of a minute boundary, so the
 * element rendering this should also carry `suppressHydrationWarning`; the
 * post-hydration re-render from `useFormatScope` then corrects the text.
 */
export function formatRelativeTime(
  value: DateInput,
  scope: FormatScope,
  now: number = Date.now(),
): string {
  const diffMins = Math.floor((now - new Date(value).getTime()) / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(value, { ...scope, locale: "en-US" }, { month: "short", day: "numeric" });
}
