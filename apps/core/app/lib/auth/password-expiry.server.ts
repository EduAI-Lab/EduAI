import prisma from "~/lib/prisma.server";

export const PASSWORD_EXPIRY_DAYS = 365;

/**
 * Per-user expiry lookup cache — same short-TTL pattern as `getPolicies()`.
 *
 * AUTH-20: this cache (like `rate-limit.server.ts`'s store) is per-process.
 * A password change is invalidated immediately on the instance that handled
 * it (`invalidatePasswordExpiryCache`), but with N instances behind a load
 * balancer, the other N-1 can keep serving a stale "not expired" verdict for
 * up to CACHE_TTL_MS. That is bounded (60s) and fails toward availability,
 * not toward letting an unnoticed-expired account in — the boundary sits at
 * PASSWORD_EXPIRY_DAYS (365d), so a 60s skew is not security-relevant. No
 * shared store (e.g. Redis) is introduced here; if multi-instance deploys
 * become the norm, revisit with a shared cache or shorten CACHE_TTL_MS.
 */
const expiryCache = new Map<string, { expired: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/** Clears cached expiry state (e.g. after a password change). */
export function invalidatePasswordExpiryCache(userId?: string): void {
  if (userId) {
    expiryCache.delete(userId);
  } else {
    expiryCache.clear();
  }
}

/**
 * Returns whether a password has expired.
 */
export function isPasswordExpired(passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  const expiresAt = new Date(passwordChangedAt);
  expiresAt.setDate(expiresAt.getDate() + PASSWORD_EXPIRY_DAYS);
  return new Date() > expiresAt;
}

/**
 * Returns the password change timestamp for a user's credential account.
 */
export async function getPasswordChangedAt(userId: string): Promise<Date | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { passwordChangedAt: true },
  });
  return account?.passwordChangedAt ?? null;
}

/**
 * Cached expiry lookup shared by both consumers: the page-loader redirect
 * below, and the `/api/*` enforcement in `root.tsx`'s middleware (AUTH-06).
 * AUTH-20: this cache is per-process — see the module-level note above.
 */
export async function isPasswordExpiredForUser(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = expiryCache.get(userId);
  if (hit && now < hit.expiresAt) {
    return hit.expired;
  }

  const changedAt = await getPasswordChangedAt(userId);
  const expired = isPasswordExpired(changedAt);
  expiryCache.set(userId, { expired, expiresAt: now + CACHE_TTL_MS });
  return expired;
}

/**
 * Returns a redirect response if the user's password has expired.
 */
export async function getExpiredPasswordRedirect(
  userId: string,
  redirectTo = "/settings?expired=1",
): Promise<Response | null> {
  const expired = await isPasswordExpiredForUser(userId);
  if (!expired) return null;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo },
  });
}
