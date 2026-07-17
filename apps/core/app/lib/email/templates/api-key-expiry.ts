import type { EmailMessage } from "~/lib/email/mailer.server";

export type ApiKeyExpiryEmailInput = {
  to: string;
  userName: string | null;
  providerName: string;
  expiresAt: Date;
  settingsUrl: string;
};

export function buildApiKeyExpiryEmail(input: ApiKeyExpiryEmailInput): EmailMessage {
  const name = input.userName?.trim() || "there";
  const expires = input.expiresAt.toUTCString();
  const subject = `Your ${input.providerName} API key expires in 7 days`;

  const text = [
    `Hi ${name},`,
    "",
    `Your API key for ${input.providerName} on EduAI is set to expire on ${expires}.`,
    "",
    "Update your key before it expires to avoid service interruptions:",
    input.settingsUrl,
    "",
    "If you no longer need this integration, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your API key for <strong>${escapeHtml(input.providerName)}</strong> on EduAI is set to expire on <strong>${escapeHtml(expires)}</strong>.</p>
      <p>Update your key before it expires to avoid service interruptions:</p>
      <p>
        <a href="${escapeHtml(input.settingsUrl)}"
           style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">
          Update API key
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">Or paste this link into your browser:<br>${escapeHtml(input.settingsUrl)}</p>
      <p style="font-size: 13px; color: #555;">If you no longer need this integration, you can ignore this email.</p>
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
