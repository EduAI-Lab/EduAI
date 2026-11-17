import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

export type BugReportUpdateEmailInput = {
  to: string;
  /** The admin's subject, sent as written. */
  subject: string;
  /** The admin's message, sent as written; line breaks are kept. */
  body: string;
  /** The report it answers, quoted under the message so the reporter knows which one. */
  reportDescription: string;
  reportedAt: Date;
};

/** How much of the original report the footer quotes. */
const QUOTE_LIMIT = 200;

/**
 * An admin's status note on a bug report ("working on it", later "fixed"),
 * mailed to the reporter from the server's own address. It is a notice, not a
 * conversation: the footer says replies to it aren't read.
 */
export function buildBugReportUpdateEmail(input: BugReportUpdateEmailInput): EmailMessage {
  const description = input.reportDescription.trim();
  const quote =
    description.length > QUOTE_LIMIT ? `${description.slice(0, QUOTE_LIMIT)}…` : description;
  const reportedOn = input.reportedAt.toUTCString();
  const footer = `This is an update on the bug report you sent on ${reportedOn}:`;
  const noReply = "Sent by an EduAI administrator. Replies to this email are not read.";

  const text = [input.body.trim(), "", "—", footer, `"${quote}"`, "", noReply].join("\n");

  const bodyHtml = escapeHtml(input.body.trim()).replace(/\r?\n/g, "<br>");
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>${bodyHtml}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 12px;">
      <p style="font-size: 13px; color: #555;">${escapeHtml(footer)}<br>
        <em>&ldquo;${escapeHtml(quote)}&rdquo;</em></p>
      <p style="font-size: 13px; color: #555;">${escapeHtml(noReply)}</p>
    </div>
  `;

  return { to: input.to, subject: input.subject.trim(), html, text };
}
