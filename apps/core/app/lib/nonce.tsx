import { createContext, useContext } from "react";

/**
 * Carries the per-request CSP nonce from the server entry down to `root.tsx`,
 * where it is stamped onto the inline theme script, `<Scripts>`, and
 * `<ScrollRestoration>`.
 *
 * The provider is rendered server-side only (see `entry.server.tsx`). The client
 * entry has no provider, so `useNonce()` returns "" during hydration — React
 * does not diff the `nonce` DOM attribute, so this causes no hydration mismatch.
 */
const NonceContext = createContext<string>("");

export const NonceProvider = NonceContext.Provider;

export function useNonce(): string {
  return useContext(NonceContext);
}
