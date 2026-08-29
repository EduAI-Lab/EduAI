import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time service-key verification for request chokepoints that need to
 * distinguish an authenticated server call without emitting guard responses.
 * Header presence or shape alone is never treated as authentication.
 *
 * Lives apart from `guards.server` because it is a pure predicate with no
 * logging or Response building: routes that only need to *elevate* trust can
 * import it without pulling in the guard machinery, and — practically — without
 * every existing `vi.mock("~/lib/auth/guards.server")` in the suite having to
 * grow another stub. `guards.server` re-exports it for existing callers.
 */
export function hasValidServiceKey(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const envKey = process.env.EDUAI_API_KEY;
  if (!authHeader?.startsWith("Bearer ") || !envKey) return false;

  const tokenHash = createHash("sha256").update(authHeader.slice(7)).digest();
  const keyHash = createHash("sha256").update(envKey).digest();
  return timingSafeEqual(tokenHash, keyHash);
}
