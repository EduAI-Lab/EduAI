import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

// Mirrors the labels in `invitation.ts`. Duplicated rather than shared because
// that module keeps its map private; a `Map` because the key is a
// caller-supplied string, not a union this file owns, so a stray one must miss.
const ROLE_LABELS = new Map<string, string>([
  ["ADMIN", "Administrator"],
  ["UNIT_ADMIN", "Unit Administrator"],
  ["INSTRUCTOR", "Instructor"],
  ["STUDENT", "Student"],
]);

export type InvitationReminderEmailInput = {
  to: string;
  inviteeName?: string | null;
  role: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  expiresAt: Date;
  platformUrl: string;
};

/**
 * Pure builder for the "your invitation is about to expire" reminder (no I/O —
 * unit-testable).
 *
 * Deliberately carries NO accept link: only the sha256 of the invite token is
 * persisted (`Invitation.tokenHash`), so the raw token in the original email
 * cannot be reconstructed here. The reminder therefore points the invitee back
 * at that first email and names the inviting admin as the fallback.
 */
export function buildInvitationReminderEmail(input: InvitationReminderEmailInput): EmailMessage {
  const name = input.inviteeName?.trim() || "there";
  const roleLabel = ROLE_LABELS.get(input.role) ?? input.role;
  const expires = input.expiresAt.toUTCString();
  const subject = "Reminder: your EduAI invitation expires soon";

  const inviterName = input.inviterName?.trim();
  const inviterEmail = input.inviterEmail?.trim();
  const inviter = inviterName
    ? inviterEmail
      ? `${inviterName} (${inviterEmail})`
      : inviterName
    : inviterEmail || "the administrator who invited you";

  const text = [
    `Hi ${name},`,
    "",
    `Your invitation to join EduAI as ${roleLabel} has not been accepted yet, and it expires on ${expires}.`,
    "",
    'To accept it, open the original invitation email and follow its "Set your password" link.',
    "For security, EduAI stores only a hash of that link, so it cannot be repeated in this reminder.",
    "",
    `If you no longer have that email, or the invitation has already expired, ask ${inviter} to send you a new one.`,
    "",
    `EduAI: ${input.platformUrl}`,
    "",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your invitation to join <strong>EduAI</strong> as <strong>${escapeHtml(roleLabel)}</strong> has not been accepted yet, and it expires on <strong>${escapeHtml(expires)}</strong>.</p>
      <p>To accept it, open the original invitation email and follow its &quot;Set your password&quot; link. For security, EduAI stores only a hash of that link, so it cannot be repeated in this reminder.</p>
      <p>If you no longer have that email, or the invitation has already expired, ask ${escapeHtml(inviter)} to send you a new one.</p>
      <p style="font-size: 13px; color: #555;">EduAI: ${escapeHtml(input.platformUrl)}</p>
      <p style="font-size: 13px; color: #555;">If you weren't expecting this, you can ignore this email.</p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}
