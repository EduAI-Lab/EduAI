import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

export type EmailVerificationEmailInput = {
  to: string;
  verificationUrl: string;
};

export function buildEmailVerificationEmail(input: EmailVerificationEmailInput): EmailMessage {
  const subject = "Verify your EduAI email";
  const text = [
    "Verify your email address to finish setting up your EduAI account:",
    input.verificationUrl,
    "",
    "This link expires in one hour. If you didn't create an EduAI account, you can ignore this email.",
  ].join("\n");
  const escapedUrl = escapeHtml(input.verificationUrl);
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>Verify your email address to finish setting up your <strong>EduAI</strong> account.</p>
      <p>
        <a href="${escapedUrl}"
           style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">
          Verify email
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">Or paste this link into your browser:<br>${escapedUrl}</p>
      <p style="font-size: 13px; color: #555;">This link expires in one hour. If you didn't create an EduAI account, you can ignore this email.</p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}
