import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

/** One person's API key use over the report window (#2039). */
export type ApiUsageReportLine = {
  name: string;
  email: string;
  purpose: string;
  requests: number;
  requestLimit: number;
  tokens: number;
  tokenLimit: number;
  /** Requests turned away by their limits or the concurrency cap. */
  refused: number;
  heavy: boolean;
};

export type ApiUsageReportEmailInput = {
  to: string;
  lines: ApiUsageReportLine[];
  heavyUsePercent: number;
  /** Where admins manage access, e.g. https://my.eduai.ok.ubc.ca/admin/api-access. */
  manageUrl: string;
};

const number = new Intl.NumberFormat("en-CA");

export function buildApiUsageReportEmail(input: ApiUsageReportEmailInput): EmailMessage {
  const heavy = input.lines.filter((line) => line.heavy);
  const subject =
    heavy.length > 0
      ? `[EduAI] API key use: ${heavy.length} ${heavy.length === 1 ? "person" : "people"} near their limit`
      : `[EduAI] API key use: ${input.lines.length} ${input.lines.length === 1 ? "person" : "people"} in the last 24 hours`;

  const describe = (line: ApiUsageReportLine) =>
    `${line.name} <${line.email}>: ${number.format(line.requests)}/${number.format(line.requestLimit)} requests, ` +
    `${number.format(line.tokens)}/${number.format(line.tokenLimit)} tokens` +
    (line.refused > 0 ? `, ${number.format(line.refused)} refused` : "") +
    (line.heavy ? " (HEAVY USE)" : "");

  const explain = `Heavy use means at least ${input.heavyUsePercent}% of a daily limit, or requests refused for being over a limit or the concurrency cap.`;

  const text = [
    "API key use by people an admin gave API access, over the last 24 hours:",
    "",
    ...input.lines.map((line) => `- ${describe(line)}\n  Purpose: ${line.purpose}`),
    "",
    explain,
    `Review or revoke access: ${input.manageUrl}`,
    "",
    "Sent by the api-usage-report job (Admin → Cron Jobs), once a day when there was any use.",
  ].join("\n");

  const rows = input.lines
    .map(
      (line) => `
        <tr${line.heavy ? ' style="background:#fff4e5;"' : ""}>
          <td style="padding:4px 12px 4px 0;">${escapeHtml(line.name)}<br><span style="color:#555;font-size:12px;">${escapeHtml(line.email)}</span></td>
          <td style="padding:4px 12px 4px 0;">${escapeHtml(line.purpose)}</td>
          <td style="padding:4px 12px 4px 0;">${number.format(line.requests)} / ${number.format(line.requestLimit)}</td>
          <td style="padding:4px 12px 4px 0;">${number.format(line.tokens)} / ${number.format(line.tokenLimit)}</td>
          <td style="padding:4px 12px 4px 0;">${line.refused > 0 ? number.format(line.refused) : ""}</td>
          <td style="padding:4px 0;">${line.heavy ? "<strong>Heavy use</strong>" : ""}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>API key use by people an admin gave API access, over the last 24 hours:</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr style="text-align:left;"><th style="padding:4px 12px 4px 0;">Person</th><th style="padding:4px 12px 4px 0;">Purpose</th><th style="padding:4px 12px 4px 0;">Requests</th><th style="padding:4px 12px 4px 0;">Tokens</th><th style="padding:4px 12px 4px 0;">Refused</th><th></th></tr>
        ${rows}
      </table>
      <p style="font-size: 13px; color: #555;">${escapeHtml(explain)}</p>
      <p><a href="${escapeHtml(input.manageUrl)}">Review or revoke access</a></p>
      <p style="font-size: 13px; color: #555;">Sent by the api-usage-report job (Admin → Cron Jobs), once a day when there was any use.</p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}
