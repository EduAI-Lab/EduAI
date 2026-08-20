import { createContext, useContext } from "react";

/**
 * Carries the per-request CSP nonce from the server entry down to `root.tsx`,
 * where it is stamped onto the inline theme script, `<Scripts>`, and
 * `<ScrollRestoration>`.
 *
 * The server and client entries both provide this context. On the client the
 * entry reads the nonce from an existing SSR script element before hydration;
 * it never copies the value to a cookie, storage, or a long-lived global.
 */
const NonceContext = createContext<string>("");

export const NonceProvider = NonceContext.Provider;

export function useNonce(): string {
  return useContext(NonceContext);
}

/**
 * Read the request nonce already attached to the SSR document.
 *
 * Browsers intentionally hide a nonce from `getAttribute("nonce")`, while the
 * standards-backed `HTMLScriptElement.nonce` property still exposes it to the
 * document's own bootstrap code. The attribute fallback keeps this helper
 * usable in DOM implementations that do not yet implement that property.
 */
export function readDocumentNonce(): string {
  if (typeof document === "undefined") return "";

  for (const element of document.querySelectorAll<HTMLScriptElement>("script")) {
    const nonce = element.nonce || element.getAttribute("nonce") || "";
    if (nonce) return nonce;
  }

  return "";
}
