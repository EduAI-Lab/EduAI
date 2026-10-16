import type { EmailMessage } from "~/lib/email/mailer.server";
import { escapeHtml } from "~/lib/email/templates/escape-html";

export type DiskAlertLevel = "WARNING" | "CRITICAL";

export type DiskAlertLine = {
  path: string;
  usedPercent: number;
  freeText: string;
  totalText: string;
  level: DiskAlertLevel | "OK";
};

export type DiskUsageAlertEmailInput = {
  to: string;
  host: string;
  level: DiskAlertLevel;
  lines: DiskAlertLine[];
  warnPercent: number;
  criticalPercent: number;
};

export function buildDiskUsageAlertEmail(input: DiskUsageAlertEmailInput): EmailMessage {
  const worst = input.lines.reduce((max, line) => Math.max(max, line.usedPercent), 0);
  const subject = `[EduAI ${input.level}] ${input.host} disk is ${worst}% full`;
  const advice =
    input.level === "CRITICAL"
      ? "Free space now: a full disk stops the databases from writing and takes the site down."
      : "Plan to free space soon, before it reaches the critical threshold.";
  const describe = (line: DiskAlertLine) =>
    `${line.path}: ${line.usedPercent}% used, ${line.freeText} free of ${line.totalText}`;

  const text = [
    `EduAI disk usage on ${input.host} is ${input.level === "CRITICAL" ? "critical" : "high"}.`,
    "",
    ...input.lines.map(
      (line) => `- ${describe(line)}${line.level === "OK" ? "" : ` (${line.level})`}`,
    ),
    "",
    advice,
    `Thresholds: warning at ${input.warnPercent}%, critical at ${input.criticalPercent}%.`,
    "Usual space users: old releases, the system journal, Docker images, and npm caches.",
    "",
    "Sent by the disk-usage-check job (Admin → Cron Jobs). You'll get at most one email a day per level.",
  ].join("\n");

  const rows = input.lines
    .map(
      (line) => `
        <tr>
          <td style="padding:4px 12px 4px 0;font-family:ui-monospace,monospace;">${escapeHtml(line.path)}</td>
          <td style="padding:4px 12px 4px 0;"><strong>${line.usedPercent}%</strong></td>
          <td style="padding:4px 12px 4px 0;">${escapeHtml(line.freeText)} free of ${escapeHtml(line.totalText)}</td>
          <td style="padding:4px 0;">${line.level === "OK" ? "" : escapeHtml(line.level)}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #111;">
      <p>EduAI disk usage on <strong>${escapeHtml(input.host)}</strong> is <strong>${input.level === "CRITICAL" ? "critical" : "high"}</strong>.</p>
      <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
      <p>${escapeHtml(advice)}</p>
      <p style="font-size: 13px; color: #555;">Thresholds: warning at ${input.warnPercent}%, critical at ${input.criticalPercent}%. Usual space users: old releases, the system journal, Docker images, and npm caches.</p>
      <p style="font-size: 13px; color: #555;">Sent by the disk-usage-check job (Admin → Cron Jobs). You'll get at most one email a day per level.</p>
    </div>
  `.trim();

  return { to: input.to, subject, text, html };
}
