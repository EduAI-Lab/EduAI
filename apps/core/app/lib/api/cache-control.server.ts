/**
 * Cache-Control for Core's slow-changing reference GETs (#1453).
 *
 * These endpoints (policies, disciplines, /api/me, preferences, the AI
 * provider/model catalogues) are re-requested on most navigations even though
 * their data changes on the order of hours. A short browser cache stops the
 * refetch without introducing a staleness window anyone will notice.
 *
 * Always `private`: every one of them is user- or role-scoped, so a shared
 * cache (the nginx in front of Core included) must never hold the body.
 */

/** Seconds, per endpoint — kept here so the TTLs are visible in one place. */
export const REFERENCE_MAX_AGE = {
  /** Effectively static reference data; also backed by an in-process cache. */
  disciplines: 120,
  /** Matches the 30s TTL AI-Tutor's `policyService` already assumes. */
  policies: 30,
  /** Per-user reads hit on most page loads. */
  profile: 30,
  /** Admin catalogues — short so a mutation is not shadowed for long. */
  aiCatalogue: 30,
} as const;

/**
 * Attach the reference-read cache header to a successful response.
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
