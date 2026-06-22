import type { EmailMessage } from "~/lib/email/mailer.server";

export type ApiKeyExpirationEmailInput = {
  to: string;
  keyName: string;
  expiresAt: Date;
  daysRemaining: number;
  settingsUrl: string;
};

export function buildApiKeyExpirationEmail(input: ApiKeyExpirationEmailInput): EmailMessage {
  const expires = input.expiresAt.toUTCString();
  const dayLabel = input.daysRemaining === 1 ? "1 day" : `${input.daysRemaining} days`;
  const subject = `EduAI API key "${input.keyName}" expires in ${dayLabel}`;

  const text = [
    `Your EduAI server API key "${input.keyName}" will expire on ${expires}.`,
    "",
    `That is ${dayLabel} from now. Create a replacement key before it expires to avoid service disruption.`,
    "",
    `Manage API keys: ${input.settingsUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>Your EduAI server API key <strong>${escapeHtml(input.keyName)}</strong> will expire on <strong>${escapeHtml(expires)}</strong>.</p>
      <p>That is <strong>${escapeHtml(dayLabel)}</strong> from now. Create a replacement key before it expires to avoid service disruption on integrations that rely on <code>x-api-key</code>.</p>
      <p>
        <a href="${escapeHtml(input.settingsUrl)}"
           style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">
          Open API key settings
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">Or paste this link into your browser:<br>${escapeHtml(input.settingsUrl)}</p>
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
