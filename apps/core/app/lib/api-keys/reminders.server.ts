import prisma from "~/lib/prisma.server";
import { authBaseURL } from "~/lib/auth/server";
import { daysUntilExpiration, parseReminderDayWindows } from "~/lib/api-keys/expiration";
import { buildApiKeyExpirationEmail } from "~/lib/email/templates/api-key-expiration";
import { sendEmail } from "~/lib/email/mailer.server";

type ApiKeyMetadata = {
  expirationReminders?: Record<string, string>;
};

export type ApiKeyReminderRunResult = {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  windows: number[];
};

function readMetadata(metadata: unknown): ApiKeyMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as ApiKeyMetadata;
}

function settingsUrl(): string {
  const base = authBaseURL.replace(/\/$/, "");
  return `${base}/settings`;
}

function shouldSendReminder(
  daysRemaining: number,
  windowDays: number,
  reminders: Record<string, string> | undefined,
): boolean {
  if (daysRemaining > windowDays) return false;
  return !reminders?.[String(windowDays)];
}

export async function sendApiKeyExpirationReminders(options?: {
  now?: Date;
  reminderDays?: number[];
}): Promise<ApiKeyReminderRunResult> {
  const now = options?.now ?? new Date();
  const windows = options?.reminderDays ?? parseReminderDayWindows(process.env.API_KEY_REMINDER_DAYS);
  const result: ApiKeyReminderRunResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    windows,
  };

  const keys = await prisma.apikey.findMany({
    where: {
      enabled: true,
      expiresAt: { not: null },
    },
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  for (const key of keys) {
    result.scanned++;
    if (!key.expiresAt || !key.user.email) {
      result.skipped++;
      continue;
    }

    const daysRemaining = daysUntilExpiration(key.expiresAt, now.getTime());
    if (daysRemaining === null || daysRemaining <= 0) {
      result.skipped++;
      continue;
    }

    const matchingWindow = windows.find((windowDays) =>
      shouldSendReminder(daysRemaining, windowDays, readMetadata(key.metadata).expirationReminders),
    );
    if (!matchingWindow) {
      result.skipped++;
      continue;
    }

    const keyName = key.name?.trim() || "Unnamed key";
    const message = buildApiKeyExpirationEmail({
      to: key.user.email,
      keyName,
      expiresAt: key.expiresAt,
      daysRemaining: Math.max(1, daysRemaining),
      settingsUrl: settingsUrl(),
    });

    try {
      await sendEmail(message);
      const metadata = readMetadata(key.metadata);
      await prisma.apikey.update({
        where: { id: key.id },
        data: {
          metadata: {
            ...metadata,
            expirationReminders: {
              ...(metadata.expirationReminders ?? {}),
              [String(matchingWindow)]: now.toISOString(),
            },
          },
        },
      });
      result.sent++;
    } catch (error) {
      console.error(`Failed to send API key expiration reminder for ${key.id}`, error);
      result.errors++;
    }
  }

  return result;
}
