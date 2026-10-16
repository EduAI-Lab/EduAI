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
import { fireAndForget, logSystemError } from "~/lib/logging.server";
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

async function alertedRecently(level: DiskAlertLevel, host: string, now: Date): Promise<boolean> {
  const recent = await prisma.systemLog.findFirst({
    where: {
      code: ALERT_CODE[level],
      createdAt: { gte: new Date(now.getTime() - REALERT_MS) },
      details: { path: ["host"], equals: host },
    },
    select: { id: true },
  });
  return recent !== null;
}

export type DiskUsageCheckResult = {
  level: DiskAlertLevel | "OK";
  lines: DiskAlertLine[];
  missing: string[];
  emailed: number;
};

/**
 * Check disk usage on the host the cron worker runs on (#1869).
 *
 * At the warning or critical threshold this writes an Admin → Logs entry and
 * emails the admins through Core's mailer (the hosts have no working `mail`,
 * #1874), at most once a day per level, so crossing from warning to critical
 * still alerts at once.
 */
export async function checkDiskUsage(
  options: { now?: Date; reader?: DiskReader; host?: string } = {},
): Promise<DiskUsageCheckResult> {
  const now = options.now ?? new Date();
  const host = options.host ?? os.hostname();
  const warnPercent = await getCronJobSetting(DISK_USAGE_CHECK_JOB, "warnPercent");
  const criticalPercent = await getCronJobSetting(DISK_USAGE_CHECK_JOB, "criticalPercent");

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

  if (level === "OK" || (await alertedRecently(level, host, now))) {
    return { level, lines, missing, emailed: 0 };
  }

  await createSystemLog({
    level: level === "CRITICAL" ? "ERROR" : "WARN",
    source: "HOST",
    code: ALERT_CODE[level],
    message: `Disk usage ${level.toLowerCase()} on ${host}: ${lines
      .filter((l) => l.level !== "OK")
      .map((l) => `${l.path} ${l.usedPercent}%`)
      .join(", ")}`,
    details: { host, warnPercent, criticalPercent, disks: lines },
  });

  let emailed = 0;
  for (const to of await alertRecipients()) {
    try {
      await sendEmail(
        buildDiskUsageAlertEmail({ to, host, level, lines, warnPercent, criticalPercent }),
      );
      emailed += 1;
    } catch (error) {
      fireAndForget(
        logSystemError({
          source: "MAIL",
          code: "DISK_USAGE_ALERT_EMAIL_FAILED",
          message: "Failed to send a disk usage alert email",
          error,
        }),
      );
    }
  }
  return { level, lines, missing, emailed };
}

/** The run message shown in Admin → Cron Jobs. */
export function formatDiskUsageMessage(result: DiskUsageCheckResult): string {
  const disks = result.lines
    .map((l) => `${l.path} ${l.usedPercent}% used (${l.freeText} free)`)
    .join("; ");
  const parts = [`${result.level}: ${disks || "no disks read"}`];
  if (result.emailed > 0) parts.push(`alert emailed to ${result.emailed} recipient(s)`);
  if (result.missing.length > 0) parts.push(`could not read ${result.missing.join(", ")}`);
  return parts.join(" — ");
}
