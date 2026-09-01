/**
 * Cache-Control for Core's reference GETs (#1453).
 *
 * Two helpers, and which one a route gets is decided by one question: does the
 * response body depend on WHO is asking?
 *
 * `private` is not the answer to that question. It keeps a body out of shared
 * caches (the nginx in front of Core included), but the browser's own cache key
 * is method + URL. The session cookie is not part of it, logging out does not
 * purge it, and Core sends no `Clear-Site-Data` on sign-out. So a second
 * request to the same URL inside the TTL is served from disk without ever
 * reaching the loader's session or role check. On a shared browser profile that
 * hands one account's body to the next account, and it hands a stale role's
 * body back to the same account after a grant.
 *
 * `Vary: Cookie` is not a fix either: it keys the entry on a value that changes
 * on every session refresh, so it removes the hit it was added to protect.
 *
 * Hence:
 *   - `withReferenceCache` — ONLY for reads whose body is identical for every
 *     authenticated caller. Auth still gates access; it just does not shape the
 *     bytes, so a cross-account hit returns what the second caller would have
 *     been sent anyway.
 *   - `withNoStore` — everything scoped to a user or varying by role.
 */

/** Seconds, per endpoint — kept here so the TTLs are visible in one place. */
export const REFERENCE_MAX_AGE = {
  /**
   * The full discipline registry: one row set, byte-identical for every
   * authenticated caller, and effectively static. Also backed by an in-process
   * cache. The only entry that survives the #1453 review — every other
   * candidate varied by session or role.
   */
  disciplines: 120,
} as const;

/**
 * Attach the reference-read cache header to a successful response.
 *
 * ONLY for bodies that do not vary by caller — see the module comment. Adding a
 * route here is a security decision, not a perf one.
 *
 * Only 200s are cached: caching a 401/403/404 would pin a denial in the browser
 * and outlive the condition that caused it (a login, a role grant, a repaired
 * record). Anything else is returned untouched.
 */
export function withReferenceCache(response: Response, maxAgeSeconds: number): Response {
  if (response.status !== 200) return response;
  response.headers.set("Cache-Control", `private, max-age=${maxAgeSeconds}`);
  return response;
}

/**
 * Forbid storing this response anywhere — for reads scoped to a user or varying
 * by role, where a cross-account or stale-role hit is the hazard.
 *
 * Applied to every status, not just 200s: a stored 403 outlives the role grant
 * that resolves it just as a stored 200 outlives the session that earned it.
 */
export function withNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
