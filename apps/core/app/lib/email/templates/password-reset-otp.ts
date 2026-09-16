import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

export type PasswordResetOtpEmailInput = {
  to: string;
  otp: string;
  expiresInMinutes: number;
};

/**
 * #1728: the password-reset one-time code.
 *
 * Deliberately link-free. A reset link would have to carry the code (or a
 * token) in a URL that lands in mail logs, referrers and chat previews, and it
 * trains people to click "reset your password" links in email. The recipient
 * types the code into a page they navigated to themselves instead.
 */
export function buildPasswordResetOtpEmail(input: PasswordResetOtpEmailInput): EmailMessage {
  const subject = "Your EduAI password reset code";
  const expiry = `${input.expiresInMinutes} minutes`;
  const text = [
    "Enter this code on the EduAI password reset page to set a new password:",
    "",
    input.otp,
    "",
    `The code expires in ${expiry} and can only be used once.`,
    "",
    "If you didn't ask to reset your EduAI password, you can ignore this email — " +
      "your password stays as it is.",
  ].join("\n");
  const escapedOtp = escapeHtml(input.otp);
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>Enter this code on the <strong>EduAI</strong> password reset page to set a new password.</p>
      <p style="font-size: 30px; font-weight: 700; letter-spacing: 6px; margin: 24px 0;">${escapedOtp}</p>
      <p style="font-size: 13px; color: #555;">The code expires in ${expiry} and can only be used once.</p>
      <p style="font-size: 13px; color: #555;">
        If you didn't ask to reset your EduAI password, you can ignore this email — your password
        stays as it is.
      </p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}
