import prisma from "~/lib/prisma.server";

export const PASSWORD_EXPIRY_DAYS = 365;

/** Per-user expiry lookup cache — same short-TTL pattern as `getPolicies()`. */
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
 * Returns a redirect response if the user's password has expired.
 */
export async function getExpiredPasswordRedirect(
  userId: string,
  redirectTo = "/settings?expired=1",
): Promise<Response | null> {
  const now = Date.now();
  const hit = expiryCache.get(userId);
  if (hit && now < hit.expiresAt) {
    return hit.expired
      ? new Response(null, {
          status: 302,
          headers: { Location: redirectTo },
        })
      : null;
  }

  const changedAt = await getPasswordChangedAt(userId);
  const expired = isPasswordExpired(changedAt);
  expiryCache.set(userId, { expired, expiresAt: now + CACHE_TTL_MS });

  if (!expired) return null;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo },
  });
}
