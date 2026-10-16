// @vitest-environment node
/**
 * #1869: the disk-usage-check job warns the admins before a server's disk fills
 * (dev filled to 99% and crashed its databases in #1856). Pinned here: the df-style
 * percentage, one report per filesystem, the two thresholds, at most one alert a
 * day per level, the email and log entry, and the run message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  systemLogFindFirst: vi.fn(),
  getCronJobSetting: vi.fn(),
  createSystemLog: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findMany: mocks.userFindMany },
    systemLog: { findFirst: mocks.systemLogFindFirst },
  },
}));
vi.mock("~/lib/db.cron-jobs.server", () => ({ getCronJobSetting: mocks.getCronJobSetting }));
vi.mock("~/lib/db.systemlog.server", () => ({ createSystemLog: mocks.createSystemLog }));
vi.mock("~/lib/email/mailer.server", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: (p: Promise<unknown>) => void p,
}));

const {
  checkDiskUsage,
  diskAlertPaths,
  formatBytes,
  formatDiskUsageMessage,
  readDiskUsage,
  resetDiskAlertMemoryForTests,
  DISK_USAGE_CHECK_JOB,
} = await import("~/lib/cron-disk-usage.server");

const NOW = new Date("2026-10-16T12:00:00.000Z");
const GB = 1024 ** 3;
const BLOCK = 4096;
const savedEnv = { ...process.env };

/**
 * A disk of `totalGb` with `usedGb` in use and `reservedGb` held back for root,
 * like ext4's 5%. Paths map to a device so two paths can share one disk.
 */
function fakeDisks(
  disks: Record<string, { device: number; totalGb: number; usedGb: number; reservedGb?: number }>,
) {
  return {
    deviceOf: async (path: string) => {
      const disk = disks[path];
      if (!disk) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return disk.device;
    },
    statfs: async (path: string) => {
      const { totalGb, usedGb, reservedGb = 0 } = disks[path]!;
      const blocks = (totalGb * GB) / BLOCK;
      const bfree = ((totalGb - usedGb) * GB) / BLOCK;
      return { bsize: BLOCK, blocks, bfree, bavail: bfree - (reservedGb * GB) / BLOCK };
    },
  };
}

/** s348 as measured on 2026-10-16: 27 GB, 23 GB used, 2.9 GB available. */
const prodToday = fakeDisks({ "/": { device: 1, totalGb: 27, usedGb: 23, reservedGb: 1.1 } });

beforeEach(() => {
  vi.clearAllMocks();
  resetDiskAlertMemoryForTests();
  process.env = { ...savedEnv };
  delete process.env.DISK_ALERT_PATHS;
  delete process.env.DISK_ALERT_EMAILS;
  mocks.getCronJobSetting.mockImplementation(async (_job: string, key: string) =>
    key === "warnPercent" ? 85 : 95,
  );
  mocks.systemLogFindFirst.mockResolvedValue(null);
  mocks.userFindMany.mockResolvedValue([{ email: "admin@ubc.ca" }]);
  mocks.sendEmail.mockResolvedValue({ delivered: true });
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("readDiskUsage", () => {
  it("reports used % the way df does, counting reserved blocks as unavailable", async () => {
    const { usage } = await readDiskUsage(["/"], prodToday);
    // df on s348 showed 89%: 23 used / (23 + 2.9 available).
    expect(usage).toEqual([
      { path: "/", totalBytes: 27 * GB, freeBytes: 2.9 * GB, usedPercent: 89 },
    ]);
  });

  it("reports a disk once when several checked paths live on it", async () => {
    const reader = fakeDisks({
      "/": { device: 1, totalGb: 100, usedGb: 66 },
      "/var/lib/docker": { device: 1, totalGb: 100, usedGb: 66 },
      "/srv/backups": { device: 2, totalGb: 50, usedGb: 10 },
    });
    const { usage } = await readDiskUsage(["/", "/var/lib/docker", "/srv/backups"], reader);
    expect(usage.map((u) => u.path)).toEqual(["/", "/srv/backups"]);
  });

  it("lists a path it cannot read instead of failing the check", async () => {
    const { usage, missing } = await readDiskUsage(["/", "/mnt/gone"], prodToday);
    expect(usage).toHaveLength(1);
    expect(missing).toEqual(["/mnt/gone"]);
  });
});

describe("diskAlertPaths", () => {
  it("defaults to the root filesystem", () => {
    expect(diskAlertPaths()).toEqual(["/"]);
  });

  it("reads a comma-separated DISK_ALERT_PATHS", () => {
    process.env.DISK_ALERT_PATHS = " /, /var/lib/docker ,";
    expect(diskAlertPaths()).toEqual(["/", "/var/lib/docker"]);
  });
});

describe("checkDiskUsage", () => {
  const run = (reader = prodToday) => checkDiskUsage({ now: NOW, reader, host: "s348.ok.ubc.ca" });

  it("reads its thresholds from the job's settings", async () => {
    await run();
    expect(mocks.getCronJobSetting).toHaveBeenCalledWith(DISK_USAGE_CHECK_JOB, "warnPercent");
    expect(mocks.getCronJobSetting).toHaveBeenCalledWith(DISK_USAGE_CHECK_JOB, "criticalPercent");
  });

  it("does nothing below the warning threshold", async () => {
    const result = await run(fakeDisks({ "/": { device: 1, totalGb: 100, usedGb: 68 } }));
    expect(result).toMatchObject({ level: "OK", emailed: 0, notSent: null });
    expect(mocks.createSystemLog).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("warns at 85%: logs to Admin → Logs and emails every active admin", async () => {
    mocks.userFindMany.mockResolvedValue([{ email: "a@ubc.ca" }, { email: "b@ubc.ca" }]);

    const result = await run();

    expect(result).toMatchObject({ level: "WARNING", emailed: 2 });
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ADMIN", isActive: true } }),
    );
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "WARN",
        source: "HOST",
        code: "DISK_USAGE_WARNING",
        message: "Disk usage warning on s348.ok.ubc.ca: / 89%",
        details: expect.objectContaining({ host: "s348.ok.ubc.ca", warnPercent: 85 }),
      }),
    );
    const email = mocks.sendEmail.mock.calls[0]![0];
    expect(email.subject).toBe("[EduAI WARNING] s348.ok.ubc.ca disk is 89% full");
    expect(email.text).toContain("/: 89% used, 2.9 GB free of 27.0 GB");
  });

  it("logs a critical disk as an error", async () => {
    const result = await run(fakeDisks({ "/": { device: 1, totalGb: 100, usedGb: 97 } }));
    expect(result.level).toBe("CRITICAL");
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "ERROR", code: "DISK_USAGE_CRITICAL" }),
    );
    expect(mocks.sendEmail.mock.calls[0]![0].subject).toMatch(/^\[EduAI CRITICAL\]/u);
  });

  it("sends at most one alert a day per level, per host", async () => {
    mocks.systemLogFindFirst.mockResolvedValue({ id: "earlier" });

    const result = await run();

    expect(result).toMatchObject({ level: "WARNING", emailed: 0 });
    expect(mocks.systemLogFindFirst).toHaveBeenCalledWith({
      where: {
        code: "DISK_USAGE_WARNING",
        createdAt: { gte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) },
        details: { path: ["host"], equals: "s348.ok.ubc.ca" },
      },
      select: { id: true },
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.createSystemLog).not.toHaveBeenCalled();
  });

  it("alerts at once on reaching critical, even after a warning today", async () => {
    mocks.systemLogFindFirst.mockImplementation(async ({ where }) =>
      where.code === "DISK_USAGE_WARNING" ? { id: "warned" } : null,
    );
    const result = await run(fakeDisks({ "/": { device: 1, totalGb: 100, usedGb: 96 } }));
    expect(result).toMatchObject({ level: "CRITICAL", emailed: 1 });
  });

  it("also emails DISK_ALERT_EMAILS, without duplicating an admin", async () => {
    process.env.DISK_ALERT_EMAILS = "ops@ubc.ca, admin@ubc.ca";
    await run();
    expect(mocks.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["admin@ubc.ca", "ops@ubc.ca"]);
  });

  // #1992 review: the once-a-day record is written only once an email went out.
  it("emails before recording the alert", async () => {
    const order: string[] = [];
    mocks.sendEmail.mockImplementation(async () => {
      order.push("email");
      return { delivered: true };
    });
    mocks.createSystemLog.mockImplementation(async () => void order.push("log"));
    await run();
    expect(order).toEqual(["email", "log"]);
  });

  // #1992 re-review: a configured mailer that fails is retried every run, but
  // logged as one entry a day, not one per recipient per run.
  it("when sending fails, retries each run but logs one entry a day", async () => {
    mocks.userFindMany.mockResolvedValue([{ email: "a@ubc.ca" }, { email: "b@ubc.ca" }]);
    mocks.sendEmail.mockRejectedValue(new Error("SMTP down"));

    const first = await run();
    expect(first).toMatchObject({ level: "WARNING", emailed: 0, notSent: "undelivered" });
    expect(mocks.createSystemLog).toHaveBeenCalledTimes(1);
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "ERROR",
        code: "DISK_USAGE_ALERT_UNDELIVERED",
        message: expect.stringContaining("sending failed for all 2 recipient(s): SMTP down"),
      }),
    );
    expect(formatDiskUsageMessage(first)).toContain("every email failed to send");

    // Retried on the next run, without a second log entry.
    expect(await run()).toMatchObject({ notSent: "undelivered" });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(4);
    expect(mocks.createSystemLog).toHaveBeenCalledTimes(1);

    // Once mail works again the alert goes out and is recorded.
    mocks.sendEmail.mockResolvedValue({ delivered: true });
    expect(await run()).toMatchObject({ emailed: 2, notSent: null });
  });

  // #1992 re-review: mail that is not set up is not a failure to retry.
  it("treats a mailer that skipped the send (no SMTP) as unsent, logged once a day", async () => {
    mocks.sendEmail.mockResolvedValue({ delivered: false });
    const result = await run();
    expect(result).toMatchObject({ emailed: 0, notSent: "unsent" });
    expect(formatDiskUsageMessage(result)).toContain("email is not set up");
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "DISK_USAGE_ALERT_UNSENT",
        message: expect.stringContaining("email is not configured"),
      }),
    );
    await run();
    expect(mocks.createSystemLog).toHaveBeenCalledTimes(1);
  });

  it("treats no recipients at all as unsent", async () => {
    mocks.userFindMany.mockResolvedValue([]);
    expect(await run()).toMatchObject({ emailed: 0, notSent: "unsent" });
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("no active admin") }),
    );
  });

  it("still sends once a day when the log row cannot be written (Postgres on a full disk)", async () => {
    // createSystemLog swallows its own write failures, so the row is simply never found.
    mocks.systemLogFindFirst.mockResolvedValue(null);
    expect((await run()).emailed).toBe(1);
    expect((await run()).emailed).toBe(0);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1);
    const later = await checkDiskUsage({
      now: tomorrow,
      reader: prodToday,
      host: "s348.ok.ubc.ca",
    });
    expect(later.emailed).toBe(1);
  });

  it("still alerts when earlier alerts cannot be read", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.systemLogFindFirst.mockRejectedValue(new Error("db down"));
    expect((await run()).emailed).toBe(1);
    spy.mockRestore();
  });

  it("caps a warning threshold set above the critical one", async () => {
    mocks.getCronJobSetting.mockImplementation(async (_job: string, key: string) =>
      key === "warnPercent" ? 98 : 90,
    );
    const result = await run(); // 89%: below both once warn is capped at 90
    expect(result.level).toBe("OK");
    const at92 = await run(fakeDisks({ "/": { device: 1, totalGb: 100, usedGb: 92 } }));
    expect(at92.level).toBe("CRITICAL");
    expect(mocks.sendEmail.mock.calls[0]![0].text).toContain("warning at 90%, critical at 90%");
  });

  it("keeps going when one email fails, and notes it on the day's alert entry", async () => {
    mocks.userFindMany.mockResolvedValue([{ email: "a@ubc.ca" }, { email: "b@ubc.ca" }]);
    mocks.sendEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const result = await run();

    expect(result).toMatchObject({ emailed: 1, notSent: null });
    expect(mocks.createSystemLog).toHaveBeenCalledTimes(1);
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "DISK_USAGE_WARNING",
        message: expect.stringContaining("sending failed for 1 recipient(s)"),
        details: expect.objectContaining({ failures: ["SMTP down"] }),
      }),
    );
  });
});

describe("formatDiskUsageMessage", () => {
  it("says what was found and who was told", async () => {
    const result = await checkDiskUsage({ now: NOW, reader: prodToday, host: "s348" });
    expect(formatDiskUsageMessage(result)).toBe(
      "WARNING: / 89% used (2.9 GB free) — alert emailed to 1 recipient(s)",
    );
  });

  it("mentions a path it could not read", () => {
    expect(
      formatDiskUsageMessage({
        level: "OK",
        lines: [],
        missing: ["/mnt/gone"],
        emailed: 0,
        notSent: null,
      }),
    ).toBe("OK: no disks read — could not read /mnt/gone");
  });
});

describe("formatBytes", () => {
  it.each([
    [2.9 * GB, "2.9 GB"],
    [512 * 1024 ** 2, "512 MB"],
  ])("formats %d as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
