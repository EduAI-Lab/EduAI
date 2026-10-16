import { promises as fs } from "node:fs";
import os from "node:os";

import { getCronJobSetting } from "~/lib/db.cron-jobs.server";
import { createSystemLog } from "~/lib/db.systemlog.server";
import { sendEmail } from "~/lib/email/mailer.server";
import {
  buildDiskUsageAlertEmail,
  type DiskAlertLevel,
  type DiskAlertLine,
} from "~/lib/email/templates/disk-usage-alert";
import prisma from "~/lib/prisma.server";

export const DISK_USAGE_CHECK_JOB = "disk-usage-check";

/** One alert email per level per day while the disk stays above that level. */
const REALERT_MS = 24 * 60 * 60 * 1000;

const ALERT_CODE = {
  WARNING: "DISK_USAGE_WARNING",
  CRITICAL: "DISK_USAGE_CRITICAL",
} satisfies Record<DiskAlertLevel, string>;

export type DiskUsage = {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
};

/** Filesystem reads, injectable for tests. */
export type DiskReader = {
  statfs: (
    path: string,
  ) => Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
  deviceOf: (path: string) => Promise<number>;
};

const nodeReader: DiskReader = {
  statfs: (path) => fs.statfs(path),
  deviceOf: async (path) => (await fs.stat(path)).dev,
};

/** `DISK_ALERT_PATHS` (comma-separated), default the root filesystem. */
export function diskAlertPaths(): string[] {
  const raw = process.env.DISK_ALERT_PATHS?.trim();
  const paths = raw
    ? raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : [];
  return paths.length > 0 ? paths : ["/"];
}

/**
 * Usage of each path's filesystem, once per filesystem: `/` and `/var/lib/docker`
 * on one disk are reported as `/` only. A missing path is returned in `missing`.
 *
 * `usedPercent` matches `df`'s Use%: used / (used + available to normal users),
 * rounded up, so the reserved root blocks count as unavailable.
 */
export async function readDiskUsage(
  paths: string[],
  reader: DiskReader = nodeReader,
): Promise<{ usage: DiskUsage[]; missing: string[] }> {
  const usage: DiskUsage[] = [];
  const missing: string[] = [];
  const seenDevices = new Set<number>();
  for (const path of paths) {
    let device: number;
    let stats: Awaited<ReturnType<DiskReader["statfs"]>>;
    try {
      device = await reader.deviceOf(path);
      if (seenDevices.has(device)) continue;
      stats = await reader.statfs(path);
    } catch {
      missing.push(path);
      continue;
    }
    seenDevices.add(device);
    const usedBytes = (stats.blocks - stats.bfree) * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usable = usedBytes + freeBytes;
    usage.push({
      path,
      totalBytes: stats.blocks * stats.bsize,
      freeBytes,
      usedPercent: usable > 0 ? Math.ceil((usedBytes / usable) * 100) : 0,
    });
  }
  return { usage, missing };
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function levelFor(percent: number, warn: number, critical: number): DiskAlertLevel | "OK" {
  if (percent >= critical) return "CRITICAL";
  if (percent >= warn) return "WARNING";
  return "OK";
}

/** Active platform admins, plus any extra addresses in `DISK_ALERT_EMAILS`. */
async function alertRecipients(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });
  const extra = (process.env.DISK_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return [...new Set([...admins.map((a) => a.email), ...extra])];
}

/** Logged once a day when an alert was due but mail is not set up (no SMTP, no recipients). */
const UNSENT_CODE = "DISK_USAGE_ALERT_UNSENT";
/** Logged once a day when a configured mailer failed to deliver any alert email. */
const UNDELIVERED_CODE = "DISK_USAGE_ALERT_UNDELIVERED";

/**
 * When this process last wrote each once-a-day entry, per host and code. The
 * limit is normally the Admin → Logs row itself, but Postgres shares the disk
 * being watched: when it is full that row cannot be written, and without this
 * every admin would be emailed every 30 minutes (#1992 review).
 *
 * It lives in the process that runs the check, so a worker restart, or an
 * admin's "Run now" served by a different process, starts with it empty and
 * can send one more email while the row cannot be written. A file would not do
 * better: on a full disk it cannot be written either.
 */
const lastRecordedAt = new Map<string, number>();

export function resetDiskAlertMemoryForTests(): void {
  lastRecordedAt.clear();
}

async function recordedRecently(code: string, host: string, now: Date): Promise<boolean> {
  const at = lastRecordedAt.get(`${host}:${code}`);
  if (at !== undefined && now.getTime() - at < REALERT_MS) return true;
  try {
    const recent = await prisma.systemLog.findFirst({
      where: {
        code,
        createdAt: { gte: new Date(now.getTime() - REALERT_MS) },
        details: { path: ["host"], equals: host },
      },
      select: { id: true },
    });
    return recent !== null;
  } catch (error) {
    console.error("[disk-usage-check] could not read earlier entries; relying on memory", error);
    return false;
  }
}

/** Write a once-a-day entry and remember it here too, in case the row cannot be written. */
async function recordOncePerDay(
  host: string,
  now: Date,
  entry: Parameters<typeof createSystemLog>[0],
): Promise<void> {
  lastRecordedAt.set(`${host}:${entry.code}`, now.getTime());
  await createSystemLog(entry);
}

export type DiskUsageCheckResult = {
  level: DiskAlertLevel | "OK";
  lines: DiskAlertLine[];
  missing: string[];
  emailed: number;
  /**
   * Why a due alert reached nobody: mail is not set up (`unsent`: no SMTP or no
   * recipients, which only configuration fixes, so the run is not failed), or a
   * configured mailer failed (`undelivered`: the run fails and the next retries).
   */
  notSent: "unsent" | "undelivered" | null;
};

/**
 * Check disk usage on the host the cron worker runs on (#1869).
 *
 * At the warning or critical threshold this emails the admins through Core's
 * mailer (the hosts have no working `mail`, #1874) and writes an Admin → Logs
 * entry, at most once a day per level, so crossing from warning to critical
 * still alerts at once. The entry is the record that the alert went out, so it
 * is written only after an email was delivered; until then every run tries
 * again (#1992 review). A failure is logged once a day too, as one entry, not
 * one per recipient per run, so an outage does not fill the disk being watched.
 */
export async function checkDiskUsage(
  options: { now?: Date; reader?: DiskReader; host?: string } = {},
): Promise<DiskUsageCheckResult> {
  const now = options.now ?? new Date();
  const host = options.host ?? os.hostname();
  const criticalPercent = await getCronJobSetting(DISK_USAGE_CHECK_JOB, "criticalPercent");
  // The two settings are validated separately; a warning above critical makes no sense.
  const warnPercent = Math.min(
    await getCronJobSetting(DISK_USAGE_CHECK_JOB, "warnPercent"),
    criticalPercent,
  );

  const { usage, missing } = await readDiskUsage(diskAlertPaths(), options.reader);
  const lines: DiskAlertLine[] = usage.map((u) => ({
    path: u.path,
    usedPercent: u.usedPercent,
    freeText: formatBytes(u.freeBytes),
    totalText: formatBytes(u.totalBytes),
    level: levelFor(u.usedPercent, warnPercent, criticalPercent),
  }));
  const level: DiskAlertLevel | "OK" = lines.some((l) => l.level === "CRITICAL")
    ? "CRITICAL"
    : lines.some((l) => l.level === "WARNING")
      ? "WARNING"
      : "OK";

  if (level === "OK" || (await recordedRecently(ALERT_CODE[level], host, now))) {
    return { level, lines, missing, emailed: 0, notSent: null };
  }

  const recipients = await alertRecipients();
  let emailed = 0;
  const failures: string[] = [];
  for (const to of recipients) {
    try {
      const { delivered } = await sendEmail(
        buildDiskUsageAlertEmail({ to, host, level, lines, warnPercent, criticalPercent }),
      );
      if (delivered) emailed += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const summary = lines
    .filter((l) => l.level !== "OK")
    .map((l) => `${l.path} ${l.usedPercent}%`)
    .join(", ");
  if (emailed > 0) {
    await recordOncePerDay(host, now, {
      level: level === "CRITICAL" ? "ERROR" : "WARN",
      source: "HOST",
      code: ALERT_CODE[level],
      message: `Disk usage ${level.toLowerCase()} on ${host}: ${summary}${
        failures.length > 0 ? ` (sending failed for ${failures.length} recipient(s))` : ""
      }`,
      details: { host, warnPercent, criticalPercent, disks: lines, failures: failures.slice(0, 5) },
    });
    return { level, lines, missing, emailed, notSent: null };
  }

  // Nothing went out. A thrown send means a configured mailer failed; otherwise
  // there was nobody to send to, or the mailer skipped the send (no SMTP).
  const notSent = failures.length > 0 ? "undelivered" : "unsent";
  const code = notSent === "undelivered" ? UNDELIVERED_CODE : UNSENT_CODE;
  if (!(await recordedRecently(code, host, now))) {
    const why =
      notSent === "undelivered"
        ? `sending failed for all ${recipients.length} recipient(s): ${failures[0]}`
        : recipients.length === 0
          ? "there is no active admin or DISK_ALERT_EMAILS address to send it to"
          : "email is not configured (no SMTP_HOST)";
    await recordOncePerDay(host, now, {
      level: "ERROR",
      source: "HOST",
      code,
      message: `Disk usage ${level.toLowerCase()} on ${host} (${summary}), but no alert was sent: ${why}`,
      details: { host, level, recipients: recipients.length, failures: failures.slice(0, 5) },
    });
  }
  return { level, lines, missing, emailed, notSent };
}

/** The run message shown in Admin → Cron Jobs. */
export function formatDiskUsageMessage(result: DiskUsageCheckResult): string {
  const disks = result.lines
    .map((l) => `${l.path} ${l.usedPercent}% used (${l.freeText} free)`)
    .join("; ");
  const parts = [`${result.level}: ${disks || "no disks read"}`];
  if (result.emailed > 0) parts.push(`alert emailed to ${result.emailed} recipient(s)`);
  if (result.notSent === "undelivered") parts.push("alert due but every email failed to send");
  if (result.notSent === "unsent") parts.push("alert due but email is not set up");
  if (result.missing.length > 0) parts.push(`could not read ${result.missing.join(", ")}`);
  return parts.join(" — ");
}
