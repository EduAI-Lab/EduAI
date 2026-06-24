import prisma from "~/lib/prisma.server";

export const PASSWORD_EXPIRY_DAYS = 365;

/**
 * Returns true when the password is overdue for a change per the UBC annual
 * rotation policy (#339). Null means the timestamp was never recorded
 * (accounts predating the policy) — those are not considered expired so
 * existing users are not immediately locked out.
 */
export function isPasswordExpired(passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  const expiresAt = new Date(passwordChangedAt);
  expiresAt.setDate(expiresAt.getDate() + PASSWORD_EXPIRY_DAYS);
  return new Date() > expiresAt;
}

/**
 * Loads the `passwordChangedAt` timestamp from the user's credential account.
 * Returns null if the user has no credential account or if it has never been
 * set (pre-policy accounts).
 */
export async function getPasswordChangedAt(userId: string): Promise<Date | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { passwordChangedAt: true },
  });
  return account?.passwordChangedAt ?? null;
}

/**
 * Returns a redirect Response to `redirectTo` when the user's password has
 * expired, otherwise returns null. Route loaders call this after resolving
 * the session to gate access to the rest of the app.
 */
export async function getExpiredPasswordRedirect(
  userId: string,
  redirectTo = "/settings?expired=1",
): Promise<Response | null> {
  const changedAt = await getPasswordChangedAt(userId);
  if (!isPasswordExpired(changedAt)) return null;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo },
  });
}
