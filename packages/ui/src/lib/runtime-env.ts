/**
 * What the current runtime is and what it provides.
 *
 * Every app in the monorepo renders on a server and hydrates in a browser, so
 * the same modules run in both places and have to ask which one they are in.
 * `typeof` is the only way to ask: under SSR `window`, `document` and
 * `navigator` are not declared at all, so `window === undefined` raises a
 * `ReferenceError` instead of answering the question.
 *
 * That makes these the standing `anti-slop/no-runtime-typeof` exemption for the
 * shared tree. There is no I/O boundary here and no payload to decode — the
 * question is about the runtime, not about a value. Collecting the checks here
 * keeps the exemption to one file with one justification, and gives callers the
 * domain predicate the rule is asking for rather than the idiom repeated at
 * thirty-odd sites (#1599).
 */

/** True in a browser: `window` exists. False under SSR and in plain Node. */
export function isBrowser(): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof window !== "undefined";
}

/** True where a DOM is mounted. Separate from {@link isBrowser} because jsdom
 * and other test environments can provide one without the other. */
export function hasDocument(): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof document !== "undefined";
}

/** True where `navigator` is present, for clipboard and platform sniffing. */
export function hasNavigator(): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof navigator !== "undefined";
}

/** True where `FileReader` exists: the browser path for reading a picked file. */
export function hasFileReader(): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof FileReader !== "undefined";
}

/**
 * A unique id, from the platform UUID generator where there is one.
 *
 * `crypto.randomUUID` is absent in older browsers and in Node before 19, and
 * this repo declares no engine floor, so the fallback stays. It is reached
 * only when the platform has nothing to offer; `fallbackPrefix` labels the id
 * in that case so it is recognisable in a log.
 */
export function randomId(fallbackPrefix = ""): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${fallbackPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
