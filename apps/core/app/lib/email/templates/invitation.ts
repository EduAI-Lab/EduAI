import type { EmailMessage } from "~/lib/email/mailer.server";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  UNIT_ADMIN: "Unit Administrator",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
};

export type InvitationEmailInput = {
  to: string;
  acceptUrl: string;
  role: string;
  inviterName?: string | null;
  expiresAt: Date;
};

/**
 * Pure builder for the invitation email (no I/O — unit-testable). Produces the
 * subject plus text and HTML bodies that point the invitee at the accept link.
 */
export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const inviter = input.inviterName?.trim() || "An administrator";
  const expires = input.expiresAt.toUTCString();
  const subject = `You've been invited to EduAI as ${roleLabel}`;

  const text = [
    `${inviter} has invited you to join EduAI as ${roleLabel}.`,
    "",
    "Set your password and activate your account:",
    input.acceptUrl,
    "",
    `This invitation expires on ${expires}.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>${escapeHtml(inviter)} has invited you to join <strong>EduAI</strong> as <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p>
        <a href="${escapeHtml(input.acceptUrl)}"
           style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">
          Set your password
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">Or paste this link into your browser:<br>${escapeHtml(input.acceptUrl)}</p>
      <p style="font-size: 13px; color: #555;">This invitation expires on ${escapeHtml(expires)}. If you weren't expecting this, you can ignore this email.</p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
