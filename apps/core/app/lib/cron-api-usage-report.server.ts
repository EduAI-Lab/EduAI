/**
 * Daily report of API key use by people an admin granted API access (#2039).
 *
 * Emails a summary of the last 24 hours when there was any use, and flags heavy
 * use: a person at or above `heavyUsePercent` of a daily limit, or with
 * requests refused for being over a limit. Requests turned away only because
 * the models were busy (503) are reported but are not heavy use: they can
 * happen at any level of use (#2042 review). Heavy use is also written to
 * Admin → Logs.
 *
 * Env:
 *   API_USAGE_REPORT_EMAILS  recipients (comma-separated); default the active admins
 */
import { authBaseURL } from "~/lib/auth/server";
import { API_ACCESS_USAGE_WINDOW_MS } from "~/lib/api-keys/access-grants.server";
import { getCronJobSetting } from "~/lib/db.cron-jobs.server";
import { createSystemLog } from "~/lib/db.systemlog.server";
import { sendEmail } from "~/lib/email/mailer.server";
import {
  buildApiUsageReportEmail,
  type ApiUsageReportLine,
} from "~/lib/email/templates/api-usage-report";
import prisma from "~/lib/prisma.server";

export const API_USAGE_REPORT_JOB = "api-usage-report";

const HEAVY_USE_CODE = "API_ACCESS_HEAVY_USE";

/** Turned away for being over a daily limit. */
const OVER_LIMIT_STATUS = 429;
/** Turned away because the granted-key slots or the models were busy. */
const BUSY_STATUS = 503;
/** Refused requests don't use up the allowance. */
const REFUSED_STATUSES = [OVER_LIMIT_STATUS, BUSY_STATUS];

async function reportRecipients(): Promise<string[]> {
  const configured = (process.env.API_USAGE_REPORT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (configured.length > 0) return [...new Set(configured)];
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });
  return [...new Set(admins.map((a) => a.email))];
}

/**
 * Last-24h use per person who made granted-key requests, with the limits of
 * the grant each request ran under (the latest one, if there were several).
 */
export async function collectApiUsage(
  now: Date,
  heavyUsePercent: number,
): Promise<ApiUsageReportLine[]> {
  const since = new Date(now.getTime() - API_ACCESS_USAGE_WINDOW_MS);
  const window = { createdAt: { gte: since }, grantId: { not: null } };

  const [counted, refused] = await Promise.all([
    prisma.apiRequestLog.groupBy({
      by: ["userId"],
      where: { ...window, status: { notIn: REFUSED_STATUSES } },
      _count: { _all: true },
      _sum: { totalTokens: true },
    }),
    prisma.apiRequestLog.groupBy({
      by: ["userId", "status"],
      where: { ...window, status: { in: REFUSED_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const overLimitBy = new Map<string, number>();
  const busyBy = new Map<string, number>();
  for (const row of refused) {
    const into = row.status === OVER_LIMIT_STATUS ? overLimitBy : busyBy;
    into.set(row.userId, (into.get(row.userId) ?? 0) + row._count._all);
  }
  const userIds = [...new Set([...counted.map((r) => r.userId), ...refused.map((r) => r.userId)])];
  if (userIds.length === 0) return [];

  const grants = await prisma.apiAccessGrant.findMany({
    where: { userId: { in: userIds } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });
  const latestGrant = new Map<string, (typeof grants)[number]>();
  for (const grant of grants) {
    if (!latestGrant.has(grant.userId)) latestGrant.set(grant.userId, grant);
  }
  const countedBy = new Map(counted.map((row) => [row.userId, row]));

  const lines: ApiUsageReportLine[] = [];
  for (const userId of userIds) {
    const grant = latestGrant.get(userId);
    if (!grant) continue;
    const requests = countedBy.get(userId)?._count._all ?? 0;
    const tokens = countedBy.get(userId)?._sum.totalTokens ?? 0;
    const overLimit = overLimitBy.get(userId) ?? 0;
    const heavy =
      overLimit > 0 ||
      requests * 100 >= grant.dailyRequestLimit * heavyUsePercent ||
      tokens * 100 >= grant.dailyTokenLimit * heavyUsePercent;
    lines.push({
      name: grant.user.name,
      email: grant.user.email,
      purpose: grant.purpose,
      requests,
      requestLimit: grant.dailyRequestLimit,
      tokens,
      tokenLimit: grant.dailyTokenLimit,
      refused: overLimit,
      busy: busyBy.get(userId) ?? 0,
      heavy,
    });
  }
  // Heavy use first, then the busiest.
  return [...lines].sort((a, b) => Number(b.heavy) - Number(a.heavy) || b.tokens - a.tokens);
}

export type ApiUsageReportResult = {
  people: number;
  heavy: number;
  emailed: number;
  /** Every send threw: a configured mailer failed, so the run fails and the next retries. */
  undelivered: boolean;
};

export async function runApiUsageReport(
  options: { now?: Date } = {},
): Promise<ApiUsageReportResult> {
  const now = options.now ?? new Date();
  const heavyUsePercent = await getCronJobSetting(API_USAGE_REPORT_JOB, "heavyUsePercent");
  const lines = await collectApiUsage(now, heavyUsePercent);
  const heavy = lines.filter((line) => line.heavy);
  if (lines.length === 0) return { people: 0, heavy: 0, emailed: 0, undelivered: false };

  if (heavy.length > 0) {
    await createSystemLog({
      level: "WARN",
      source: "API",
      code: HEAVY_USE_CODE,
      message: `Heavy API key use in the last 24 hours: ${heavy
        .map((line) => `${line.email} (${line.requests} requests, ${line.tokens} tokens)`)
        .join(", ")}`,
      details: { heavyUsePercent, people: heavy },
    });
  }

  const recipients = await reportRecipients();
  const manageUrl = `${authBaseURL}/admin/api-access`;
  let emailed = 0;
  let failures = 0;
  for (const to of recipients) {
    try {
      const { delivered } = await sendEmail(
        buildApiUsageReportEmail({ to, lines, heavyUsePercent, manageUrl }),
      );
      if (delivered) emailed += 1;
    } catch (error) {
      failures += 1;
      console.error("[api-usage-report] send failed", error);
    }
  }

  return {
    people: lines.length,
    heavy: heavy.length,
    emailed,
    undelivered: recipients.length > 0 && failures === recipients.length,
  };
}

/** The run message shown in Admin → Cron Jobs. */
export function formatApiUsageReportMessage(result: ApiUsageReportResult): string {
  if (result.people === 0) return "No API key use by granted users in the last 24 hours";
  const parts = [
    `${result.people} ${result.people === 1 ? "person" : "people"} used API keys`,
    `${result.heavy} heavy`,
  ];
  if (result.undelivered) parts.push("every report email failed to send");
  else if (result.emailed === 0)
    parts.push("report not emailed (email not set up or no recipients)");
  else parts.push(`report emailed to ${result.emailed} recipient(s)`);
  return parts.join(" — ");
}
