import prisma from "~/lib/prisma.server";
import { sendEmail } from "~/lib/email/mailer.server";
import { buildInvitationReminderEmail } from "~/lib/email/templates/invitation-reminder";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import { authBaseURL } from "~/lib/auth/server";

/**
 * This job's cron cadence. The window is one interval wide so consecutive runs
 * tile the timeline: no gaps (missed reminders) and no overlap (duplicates).
 */
const RUN_INTERVAL_HOURS = 24;

/**
 * Mirrors `DEFAULT_EXPIRY_HOURS` in `~/lib/invitations/service.server` — that
 * module keeps it private, so it is duplicated rather than imported.
 */
const DEFAULT_EXPIRY_HOURS = 72;

/** The configured invitation TTL, read exactly as the invitation service reads it. */
function inviteExpiryHours(): number {
  const raw = process.env.INVITE_EXPIRY_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRY_HOURS;
}

/**
 * How many whole UTC days ahead of expiry to remind.
 *
 * Derived from the configured TTL rather than hardcoded: invitations live 72h
 * by default, but `INVITE_EXPIRY_HOURS` can shorten that to less than a day and
 * a fixed "one day out" window would then match nothing and silently remind
 * nobody. The target is roughly a third of the TTL remaining, floored to whole
 * days (the window is a UTC calendar day, so the job is immune to run-time
 * jitter) and capped one interval below the TTL — reminding earlier than that
 * would put the covering run before the invitation was even created.
 */
function reminderLeadDays(expiryHours: number): number {
  const targetLeadHours = expiryHours / 3;
  const maxLeadHours = expiryHours - RUN_INTERVAL_HOURS;
  return Math.max(0, Math.floor(Math.min(targetLeadHours, maxLeadHours) / RUN_INTERVAL_HOURS));
}

/**
 * Finds every PENDING invitation expiring in the reminder window and sends the
 * invitee one reminder. Returns the number of emails sent.
 *
 * Idempotency comes from the window, not from a persisted flag: the range is an
 * exact UTC calendar day, so an invitation lands in it on exactly one daily run
 * (same approach as `cron-notify-api-key-expiry.server.ts`). The trade-off is
 * that a skipped scheduler run means a skipped reminder, and two runs on the
 * same UTC day would double-send; a persisted `reminderSentAt` would be needed
 * to close that.
 */
export async function notifyExpiringInvitations(): Promise<{ notified: number }> {
  const now = new Date();
  const leadDays = reminderLeadDays(inviteExpiryHours());

  // Start/end of the target UTC day (today + leadDays).
  const targetDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + leadDays),
  );
  const targetDayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + leadDays + 1),
  );
  // With a sub-day TTL the target day is today, whose earlier hours are already
  // gone: never remind about an invitation that has already expired. Clamping
  // the past edge only shrinks the window, so it cannot cause a double-send.
  const windowStart = targetDayStart > now ? targetDayStart : now;

  const invitations = await prisma.invitation.findMany({
    where: {
      status: "PENDING",
      expiresAt: {
        gte: windowStart,
        lt: targetDayEnd,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      expiresAt: true,
      // Null when the inviting admin's account has since been deleted.
      invitedBy: { select: { name: true, email: true } },
    },
  });

  let notified = 0;
  for (const invitation of invitations) {
    try {
      const message = buildInvitationReminderEmail({
        to: invitation.email,
        inviteeName: invitation.name,
        role: invitation.role,
        inviterName: invitation.invitedBy?.name ?? null,
        inviterEmail: invitation.invitedBy?.email ?? null,
        expiresAt: invitation.expiresAt,
        platformUrl: authBaseURL,
      });
      await sendEmail(message);
      notified++;
    } catch (error) {
      fireAndForget(
        logSystemError({
          source: "API",
          code: "INVITATION_REMINDER_EMAIL_FAILED",
          message: `Failed to send invitation expiry reminder for invitation ${invitation.id}`,
          error,
        }),
      );
    }
  }

  return { notified };
}
