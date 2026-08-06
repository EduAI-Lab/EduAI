import prisma from "~/lib/prisma.server";
import { TOKEN_RESET_PATHS } from "./password-policy";

/**
 * Resolves the userId a password-reuse check should run against for a given
 * better-auth password-setting path (#339 / #225 AUTH-09).
 *
 * - Token-based reset (`/reset-password`) reads the target user from the
 *   `Verification` table, and only if the token exists and has not expired.
 * - Every other password-setting path (`/change-password`, `/set-password`)
 *   relies on the caller's active session.
 *
 * Returns `null` when the identity cannot be resolved (missing/invalid/expired
 * token, or no session) — callers MUST treat `null` as "deny", not "skip the
 * check": silently proceeding without a resolved userId is exactly the
 * fail-open bug AUTH-09 fixes.
 */
export async function resolvePasswordReuseUserId({
  path,
  token,
  getSessionUserId,
}: {
  path: string;
  token: string | undefined;
  getSessionUserId: () => Promise<string | null>;
}): Promise<string | null> {
  if (TOKEN_RESET_PATHS.has(path)) {
    if (typeof token !== "string" || token.length === 0) return null;
    const verificationId = `reset-password:${token}`;
    const verification = await prisma.verification.findUnique({
      where: { id: verificationId },
      select: { value: true, expiresAt: true },
    });
    if (!verification || verification.expiresAt <= new Date()) return null;
    return verification.value;
  }

  return getSessionUserId();
}
