/**
 * How EduAI Core's cross-app entry points are spelled, in one place.
 *
 * AI Tutor and Question Maker both link back to Core and each kept its own
 * byte-identical copy of these builders, so a change to a Core route — a moved
 * page, a new query param — needed two matching edits and silently half-worked
 * if you made only one. The route knowledge lives here; both apps call it.
 *
 * Deliberately NOT reading `VITE_CORE_URL` here. Each app resolves its own Core
 * origin and passes it in: Vite substitutes `import.meta.env.VITE_*` statically
 * per app at build time, and a shared module that reached for it dynamically
 * would neither pick up the substitution reliably nor respond to `vi.stubEnv`
 * in each app's tests. The env read is the app's; the path is Core's.
 */

/**
 * Core login, forcing a fresh sign-in and round-tripping the caller back.
 *
 * `force=1` is what breaks the cross-subdomain session redirect loop, and
 * `redirect` is encoded so a return URL carrying its own query string (or its
 * own `redirect`) survives intact.
 */
export function coreLoginUrl(coreUrl: string, returnUrl: string): string {
  return `${coreUrl}/login?force=1&redirect=${encodeURIComponent(returnUrl)}`;
}

/** Core's dashboard — the extensions' "back to EduAI" target. */
export function coreDashboardUrl(coreUrl: string): string {
  return `${coreUrl}/dashboard`;
}

/** Core's AI service status page — the extensions have no such route of their own. */
export function coreStatusUrl(coreUrl: string): string {
  return `${coreUrl}/status`;
}
