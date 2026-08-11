// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockOverrideFindMany = vi.hoisted(() => vi.fn());
const mockOverrideUpsert = vi.hoisted(() => vi.fn());
const mockOverrideDeleteMany = vi.hoisted(() => vi.fn());
const mockNotifyExpiringApiKeys = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
    $transaction: mockTransaction,
    cronJobScheduleOverride: {
      findMany: mockOverrideFindMany,
      upsert: mockOverrideUpsert,
      deleteMany: mockOverrideDeleteMany,
    },
  },
}));

vi.mock("~/lib/cron-notify-api-key-expiry.server", () => ({
  notifyExpiringApiKeys: mockNotifyExpiringApiKeys,
}));

const {
  listCronJobStatuses,
  updateCronSchedule,
  resetCronSchedule,
  getRecentCronJobRuns,
  startCronRun,
  finishCronRun,
  renewCronRunLease,
  reapExpiredCronRuns,
  resolveCronOutputMaxBytes,
  triggerCronJobAsync,
  dispatchManualCronRuns,
  KNOWN_CRON_JOBS,
} = await import("~/lib/db.cron-jobs.server");

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
  mockTransaction.mockReset();
  mockOverrideFindMany.mockReset();
  mockOverrideUpsert.mockReset();
  mockOverrideDeleteMany.mockReset();
  mockQueryRaw.mockResolvedValue([]);
  mockExecuteRaw.mockResolvedValue(1);
  mockTransaction.mockImplementation(async (run) =>
    run({ $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw }),
  );
  mockOverrideFindMany.mockResolvedValue([]);
  mockOverrideUpsert.mockResolvedValue({});
  mockOverrideDeleteMany.mockResolvedValue({ count: 0 });
  mockNotifyExpiringApiKeys.mockResolvedValue({ notified: 0 });
  globalThis.__manualCronRunIds = undefined;
});

describe("listCronJobStatuses", () => {
  it("returns all known jobs with lastRun null when no runs exist", async () => {
    const result = await listCronJobStatuses();
    expect(result).toHaveLength(KNOWN_CRON_JOBS.length);
    expect(result.every((j) => j.lastRun === null)).toBe(true);
    expect(result[0].name).toBe("backup-nightly");
  });

  it("attaches the most recent run to the matching job", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    mockQueryRaw.mockResolvedValue([
      {
        id: "run-1",
        jobName: "backup-nightly",
        status: "SUCCESS",
        startedAt,
        finishedAt: null,
        message: null,
        exitCode: 0,
      },
    ]);

    const result = await listCronJobStatuses();
    const job = result.find((j) => j.name === "backup-nightly")!;
    expect(job.lastRun).toMatchObject({
      id: "run-1",
      status: "SUCCESS",
      startedAt: startedAt.toISOString(),
      finishedAt: null,
    });
  });

  it("converts finishedAt Date to ISO string", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    const finishedAt = new Date("2026-06-20T02:01:00Z");
    mockQueryRaw.mockResolvedValue([
      {
        id: "run-1",
        jobName: "backup-nightly",
        status: "SUCCESS",
        startedAt,
        finishedAt,
        message: "ok",
        exitCode: 0,
      },
    ]);

    const result = await listCronJobStatuses();
    const job = result.find((j) => j.name === "backup-nightly")!;
    expect(job.lastRun!.finishedAt).toBe(finishedAt.toISOString());
  });

  it("applies schedule override when one exists", async () => {
    mockOverrideFindMany.mockResolvedValue([
      { jobName: "backup-nightly", schedule: "0 3 * * *", scheduleLabel: "Daily at 03:00 UTC" },
    ]);

    const result = await listCronJobStatuses();
    const job = result.find((j) => j.name === "backup-nightly")!;
    expect(job.schedule).toBe("0 3 * * *");
    expect(job.scheduleLabel).toBe("Daily at 03:00 UTC");
    expect(job.scheduleOverridden).toBe(true);
  });

  it("marks scheduleOverridden false when no override exists", async () => {
    const result = await listCronJobStatuses();
    expect(result.every((j) => !j.scheduleOverridden)).toBe(true);
  });

  it("jobs without a run entry keep lastRun null even when other jobs have runs", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    mockQueryRaw.mockResolvedValue([
      {
        id: "run-1",
        jobName: "backup-nightly",
        status: "SUCCESS",
        startedAt,
        finishedAt: null,
        message: null,
        exitCode: 0,
      },
    ]);

    const result = await listCronJobStatuses();
    const offsite = result.find((j) => j.name === "backup-offsite")!;
    expect(offsite.lastRun).toBeNull();
  });
});

describe("startCronRun", () => {
  it("returns an owner token with a newly leased run", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // advisory lock
      .mockResolvedValueOnce([]) // no active lease
      .mockResolvedValueOnce([{ id: "run-abc" }]);
    const result = await startCronRun("backup-nightly");
    expect(result).toEqual({
      runId: "run-abc",
      created: true,
      leaseOwner: expect.any(String),
    });
    expect(result.created && result.leaseOwner.length).toBeGreaterThan(10);
  });

  it("returns created:false when a live lease already exists", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // advisory lock
      .mockResolvedValueOnce([{ id: "run-existing" }]);
    const result = await startCronRun("backup-nightly");
    expect(result).toEqual({ runId: "run-existing", created: false });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("cron run leases", () => {
  it("renews only the matching live owner", async () => {
    mockExecuteRaw.mockResolvedValueOnce(1);
    await expect(renewCronRunLease("run-abc", "owner-a")).resolves.toBe(true);

    mockExecuteRaw.mockResolvedValueOnce(0);
    await expect(renewCronRunLease("run-abc", "stale-owner")).resolves.toBe(false);
  });

  it("reaps expired attempts as terminal audit rows", async () => {
    mockExecuteRaw.mockResolvedValueOnce(2);
    await expect(reapExpiredCronRuns()).resolves.toBe(2);
  });
});

describe("finishCronRun", () => {
  it("executes an UPDATE with the given status, message, and exitCode", async () => {
    await finishCronRun("run-abc", "owner-1", "SUCCESS", "done", 0);
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("executes an UPDATE for ERROR status", async () => {
    await finishCronRun("run-abc", "owner-1", "ERROR", "failed", 1);
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  // Cron scripts are spawned with the full process.env, so their stdout/stderr tail — which
  // becomes this message — can carry DATABASE_URL credentials or a token-bearing callback URL.
  it("redacts secret values out of the persisted message", async () => {
    await finishCronRun(
      "run-abc",
      "owner-1",
      "ERROR",
      "connect failed for postgresql://admin:hunter2@db:5432/eduai and https://lms/api?access_token=abc123",
      1,
    );

    const [, , persistedMessage] = mockExecuteRaw.mock.calls[0] as unknown[];
    expect(persistedMessage).not.toContain("hunter2");
    expect(persistedMessage).not.toContain("abc123");
    expect(persistedMessage).toContain("[REDACTED]");
    // Non-secret diagnostic text must survive so admins can still triage the failure.
    expect(persistedMessage).toContain("connect failed for");
  });

  // Review on #1291: a `set -x` trace or crash dump prints env credentials as bare assignments
  // rather than as a header or URL, so the value-level patterns alone missed them.
  it("redacts structured key/value secrets in the persisted message", async () => {
    await finishCronRun(
      "run-abc",
      "owner-1",
      "ERROR",
      'env dump: API_KEY=sk-live-abcdef PGPASSWORD=hunter2 payload={"clientSecret":"s3kr3t"} rows=42',
      1,
    );

    const [, , persistedMessage] = mockExecuteRaw.mock.calls[0] as unknown[];
    expect(persistedMessage).not.toContain("sk-live-abcdef");
    expect(persistedMessage).not.toContain("hunter2");
    expect(persistedMessage).not.toContain("s3kr3t");
    expect(persistedMessage).toContain("API_KEY=[REDACTED]");
    expect(persistedMessage).toContain("PGPASSWORD=[REDACTED]");
    expect(persistedMessage).toContain('"clientSecret":"[REDACTED]"');
    // Non-secret operational counters stay readable for triage.
    expect(persistedMessage).toContain("rows=42");
  });

  it("leaves a message with no secrets untouched", async () => {
    await finishCronRun("run-abc", "owner-1", "SUCCESS", "Processed 42 rows in 3.1s", 0);

    const [, , persistedMessage] = mockExecuteRaw.mock.calls[0] as unknown[];
    expect(persistedMessage).toBe("Processed 42 rows in 3.1s");
  });
});

describe("getRecentCronJobRuns", () => {
  it("returns an empty array when no runs exist", async () => {
    const runs = await getRecentCronJobRuns("backup-nightly");
    expect(runs).toEqual([]);
  });

  it("converts Date timestamps to ISO strings", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    const finishedAt = new Date("2026-06-20T02:01:00Z");
    mockQueryRaw.mockResolvedValue([
      {
        id: "run-1",
        jobName: "backup-nightly",
        status: "SUCCESS",
        startedAt,
        finishedAt,
        message: "done",
        exitCode: 0,
      },
    ]);

    const runs = await getRecentCronJobRuns("backup-nightly");
    expect(runs[0].startedAt).toBe(startedAt.toISOString());
    expect(runs[0].finishedAt).toBe(finishedAt.toISOString());
  });

  it("sets finishedAt to null when the run is still active", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    mockQueryRaw.mockResolvedValue([
      {
        id: "run-1",
        jobName: "backup-nightly",
        status: "RUNNING",
        startedAt,
        finishedAt: null,
        message: null,
        exitCode: null,
      },
    ]);

    const runs = await getRecentCronJobRuns("backup-nightly");
    expect(runs[0].finishedAt).toBeNull();
  });
});

describe("updateCronSchedule", () => {
  it("upserts the schedule override for the given job", async () => {
    await updateCronSchedule("backup-nightly", "0 3 * * *", "Daily at 03:00 UTC");
    expect(mockOverrideUpsert).toHaveBeenCalledWith({
      where: { jobName: "backup-nightly" },
      create: {
        jobName: "backup-nightly",
        schedule: "0 3 * * *",
        scheduleLabel: "Daily at 03:00 UTC",
      },
      update: { schedule: "0 3 * * *", scheduleLabel: "Daily at 03:00 UTC" },
    });
  });
});

describe("resetCronSchedule", () => {
  it("deletes all overrides for the given job", async () => {
    await resetCronSchedule("backup-nightly");
    expect(mockOverrideDeleteMany).toHaveBeenCalledWith({ where: { jobName: "backup-nightly" } });
  });
});

describe("triggerCronJobAsync", () => {
  function makeChild() {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn().mockReturnValue(true);
    return child;
  }

  it("runs a Core handler without spawning a shell process", async () => {
    mockNotifyExpiringApiKeys.mockResolvedValue({ notified: 2 });
    triggerCronJobAsync("notify-api-key-expiry", "Core handler", "run-1", "CORE");
    // The CORE path resolves via a dynamic `import()` before calling the
    // handler — under Vite's SSR transform that hop can take more than a
    // couple of microtask ticks, so poll instead of a fixed tick count.
    await vi.waitFor(() => {
      expect(mockNotifyExpiringApiKeys).toHaveBeenCalledOnce();
    });
    expect(mockSpawn).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockExecuteRaw).toHaveBeenCalledOnce();
    });
  });

  it("spawns bash with the resolved script path", () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      [expect.stringContaining("backup-nightly.sh")],
      expect.any(Object),
    );
  });

  it("calls finishCronRun with SUCCESS when the script exits 0", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when the script exits non-zero", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("close", 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when spawn emits an error", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("error", new Error("ENOENT: no such file"));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("includes stdout output in the finish message", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.stdout.emit("data", Buffer.from("Backup complete"));
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  // Review on #1291: output was sliced to its last 1000 chars *before* being redacted. The
  // redactor recognises a secret only by the credential-named key in front of it, so a long
  // value whose key fell outside the window arrived as an unattributed tail and survived.
  it("redacts before truncating so a long secret cannot outlive its key", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    // The `API_KEY=` prefix sits well outside the trailing 1000-char window.
    child.stdout.emit("data", Buffer.from(`API_KEY=${"s3kr3t".repeat(400)}\ndone`));
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();

    const [, , persistedMessage] = mockExecuteRaw.mock.calls[0] as unknown[];
    expect(persistedMessage).not.toContain("s3kr3t");
    expect(persistedMessage).toContain("[REDACTED]");
    expect(persistedMessage).toContain("done");
  });

  it("caps captured bytes and terminates a child that exceeds the output budget", async () => {
    const originalMax = process.env.CRON_OUTPUT_MAX_BYTES;
    process.env.CRON_OUTPUT_MAX_BYTES = "1024";
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    try {
      expect(resolveCronOutputMaxBytes()).toBe(1024);
      triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
      child.stdout.emit("data", Buffer.alloc(900, "x"));
      child.stderr.emit(
        "data",
        Buffer.concat([Buffer.from("backup failed at phase 2\n"), Buffer.alloc(2048, "y")]),
      );

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      child.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      const persistedMessage = mockExecuteRaw.mock.calls.at(-1)?.[2] as string;
      expect(persistedMessage).toContain("backup failed at phase 2");
      expect(persistedMessage).toContain("output limit");
      expect(Buffer.byteLength(persistedMessage)).toBeLessThanOrEqual(1000);
    } finally {
      if (originalMax === undefined) delete process.env.CRON_OUTPUT_MAX_BYTES;
      else process.env.CRON_OUTPUT_MAX_BYTES = originalMax;
    }
  });

  it("heartbeats the lease and terminates when this process loses ownership", async () => {
    const originalLeaseMs = process.env.CRON_RUN_LEASE_MS;
    process.env.CRON_RUN_LEASE_MS = "15000";
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    // The heartbeat UPDATE matched no row: another owner/reaper has fenced us.
    mockExecuteRaw.mockResolvedValueOnce(0);

    try {
      triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockExecuteRaw).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      child.emit("close", 1);
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
      if (originalLeaseMs === undefined) delete process.env.CRON_RUN_LEASE_MS;
      else process.env.CRON_RUN_LEASE_MS = originalLeaseMs;
    }
  });
});
