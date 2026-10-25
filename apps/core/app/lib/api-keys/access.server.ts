import prisma from "~/lib/prisma.server";
import { getActiveApiAccessGrant } from "./access-grants.server";

export async function isActiveAdminUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  return user?.role === "ADMIN" && user.isActive === true;
}

/** Key-management paths a user with an API access grant may call on their own keys (#2039). */
const GRANTEE_API_KEY_PATHS = new Set([
  "/api-key/create",
  "/api-key/delete",
  "/api-key/list",
  "/api-key/get",
]);

/**
 * Why `userId` may not call the api-key plugin's management endpoint `path`,
 * or null when they may. Active admins may always. Since #2039 an active
 * non-admin with an API access grant may create, list, view and delete their
 * own keys (the plugin scopes those to the caller), but not update them, and a
 * new key must not expire after the grant does.
 */
export async function apiKeyManagementDenial(
  userId: string | null | undefined,
  path: string,
  /** The create request's `expiresIn`, parsed by the caller; null when absent or unusable. */
  expiresInSeconds: number | null,
  now: Date = new Date(),
): Promise<string | null> {
  if (!userId) return "API key management restricted to admin users";
  if (await isActiveAdminUser(userId)) return null;

  const [user, grant] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } }),
    getActiveApiAccessGrant(userId, now),
  ]);
  if (!user?.isActive || !grant) return "API key management restricted to admin users";
  if (!GRANTEE_API_KEY_PATHS.has(path)) return "Only an admin can change an API key";

  if (path === "/api-key/create") {
    if (expiresInSeconds === null) return "API keys must have an expiration date";
    if (now.getTime() + expiresInSeconds * 1000 > grant.expiresAt.getTime()) {
      return `Your key can't expire after your API access ends (${grant.expiresAt.toISOString().slice(0, 10)})`;
    }
  }
  return null;
}
