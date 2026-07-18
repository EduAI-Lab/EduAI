import prisma from "~/lib/prisma.server";
import { sendEmail } from "~/lib/email/mailer.server";
import { buildApiKeyExpiryEmail } from "~/lib/email/templates/api-key-expiry";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import { authBaseURL } from "~/lib/auth/server";

const WARN_DAYS = 7;

/**
 * Finds all enabled API keys expiring in exactly WARN_DAYS calendar days and
 * sends one notification email per key. Returns the number of emails sent.
 */
export async function notifyExpiringApiKeys(): Promise<{ notified: number }> {
  const now = new Date();
  // Compute the start/end of the target UTC day (today + WARN_DAYS).
  const targetDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + WARN_DAYS),
  );
  const targetDayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + WARN_DAYS + 1),
  );

  const settings = await prisma.userProviderSettings.findMany({
    where: {
      apiKey: { not: null },
      isEnabled: true,
      apiKeyExpiresAt: {
        gte: targetDayStart,
        lt: targetDayEnd,
      },
    },
    include: {
      user: { select: { email: true, name: true } },
      provider: { select: { displayName: true } },
    },
  });

  const settingsUrl = `${authBaseURL}/settings`;

  let notified = 0;
  for (const row of settings) {
    try {
      const message = buildApiKeyExpiryEmail({
        to: row.user.email,
        userName: row.user.name,
        providerName: row.provider.displayName,
        expiresAt: row.apiKeyExpiresAt!,
        settingsUrl,
      });
      await sendEmail(message);
      notified++;
    } catch (error) {
      fireAndForget(
        logSystemError({
          source: "API",
          code: "API_KEY_EXPIRY_EMAIL_FAILED",
          message: `Failed to send API key expiry email to user ${row.userId}`,
          error,
        }),
      );
    }
  }

  return { notified };
}
