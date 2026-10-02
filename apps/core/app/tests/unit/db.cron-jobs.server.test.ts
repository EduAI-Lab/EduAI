// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockOverrideFindMany = vi.hoisted(() => vi.fn());
const mockOverrideUpsert = vi.hoisted(() => vi.fn());
const mockOverrideDeleteMany = vi.hoisted(() => vi.fn());
const mockSettingFindMany = vi.hoisted(() => vi.fn());
const mockSettingFindUnique = vi.hoisted(() => vi.fn());
const mockSettingUpsert = vi.hoisted(() => vi.fn());
const mockSettingDeleteMany = vi.hoisted(() => vi.fn());
const mockNotifyExpiringApiKeys = vi.hoisted(() => vi.fn());
const mockNotifyExpiringInvitations = vi.hoisted(() => vi.fn());
const mockPurgeDeletedMaterials = vi.hoisted(() => vi.fn());

const runAiStatusProbeMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/status-probe.server", () => ({
  runAiStatusProbe: runAiStatusProbeMock,
}));

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
    cronJobSetting: {
      findMany: mockSettingFindMany,
      findUnique: mockSettingFindUnique,
      upsert: mockSettingUpsert,
      deleteMany: mockSettingDeleteMany,
    },
  },
}));

vi.mock("~/lib/cron-notify-api-key-expiry.server", () => ({
  notifyExpiringApiKeys: mockNotifyExpiringApiKeys,
}));

vi.mock("~/lib/cron-notify-invitation-expiry.server", () => ({
  notifyExpiringInvitations: mockNotifyExpiringInvitations,
}));

vi.mock("~/lib/cron-purge-deleted-materials.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/cron-purge-deleted-materials.server")>()),
  purgeDeletedMaterials: mockPurgeDeletedMaterials,
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
  getCronJobSetting,
  updateCronJobSetting,
  resetCronJobSetting,
  CronJobSettingError,
  KNOWN_CRON_JOBS,
} = await import("~/lib/db.cron-jobs.server");

/** Reassemble the SQL text of a `$queryRaw` tagged-template call. */
function sqlTextOf(callArgs: unknown[]): string {
  // SAFETY: Prisma's $queryRaw is a tagged template, so its first argument is
  // always the TemplateStringsArray holding the literal SQL chunks.
  const template = callArgs[0] as TemplateStringsArray | undefined;
  return Array.from(template?.raw ?? [])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeStubChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn().mockReturnValue(true);
  return child;
}

interface PendingRunRow {
  id: string;
  jobName: string;
  leaseOwner: string;
  status: "RUNNING" | "SUCCESS" | "ERROR";
  triggerSource: "SCHEDULE" | "ADMIN_UI" | "ADMIN_CHAT" | "UNKNOWN";
}

/**
 * Evaluate the manual-dispatch claim query's WHERE clause against in-memory
 * rows instead of replacing its result wholesale. Seeding the result directly
 * would pass even if the predicate were `WHERE false`, which is exactly how a
 * filter that matched zero rows in production survived review.
 */
function applyClaimFilter(sql: string, rows: PendingRunRow[]): PendingRunRow[] {
  const where = /WHERE (.+?) ORDER BY/.exec(sql)?.[1];
  if (!where) throw new Error(`manual-dispatch query has no WHERE clause: ${sql}`);

  let matched = rows;
  for (const condition of where.split(/\s+AND\s+/)) {
    const status = /^status = '(\w+)'::"CronJobStatus"$/.exec(condition);
    if (status) {
      matched = matched.filter((row) => row.status === status[1]);
      continue;
    }
    const inList = /^"triggerSource" IN \((.+)\)$/.exec(condition);
    if (inList) {
      const allowed = new Set(
        [...inList[1].matchAll(/'(\w+)'::"CronJobTriggerSource"/g)].map((match) => match[1]),
      );
      matched = matched.filter((row) => allowed.has(row.triggerSource));
      continue;
    }
    // Unmodelled predicates are a test failure, not a silent pass: any change to
    // the claim filter has to be reflected here deliberately.
    throw new Error(`unsupported predicate in manual-dispatch query: ${condition}`);
  }
  return matched;
}

function seedPendingRuns(rows: PendingRunRow[]): void {
  mockQueryRaw.mockImplementation((...args: unknown[]) => {
    const sql = sqlTextOf(args);
    const isClaimQuery = sql.includes("FROM cron_job_runs") && sql.includes('"triggerSource" IN (');
    return Promise.resolve(isClaimQuery ? applyClaimFilter(sql, rows) : []);
  });
}

/** Let the CORE path's dynamic import and its promise chain settle. */
function flushDispatch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** triggerCronJobAsync is reached only for a claimed row, and claiming is synchronous. */
function wasClaimed(runId: string): boolean {
  return globalThis.__manualCronRunIds?.has(runId) ?? false;
}

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
  mockSettingFindMany.mockReset();
  mockSettingFindUnique.mockReset();
  mockSettingUpsert.mockReset();
  mockSettingDeleteMany.mockReset();
  mockSettingFindMany.mockResolvedValue([]);
  mockSettingFindUnique.mockResolvedValue(null);
  mockSettingUpsert.mockResolvedValue({});
  mockSettingDeleteMany.mockResolvedValue({ count: 0 });
  mockNotifyExpiringApiKeys.mockResolvedValue({ notified: 0 });
  mockNotifyExpiringInvitations.mockResolvedValue({ notified: 0 });
  mockPurgeDeletedMaterials.mockResolvedValue({
    purged: 0,
    truncated: false,
    cutoff: new Date("2026-07-02T05:00:00.000Z"),
    retainDays: 90,
  });
  delete globalThis.__manualCronRunIds;
});

describe("listCronJobStatuses", () => {
  it("returns all known jobs with lastRun null when no runs exist", async () => {
    const result = await listCronJobStatuses();
    expect(result).toHaveLength(KNOWN_CRON_JOBS.length);
    expect(result.every((j) => j.lastRun === null)).toBe(true);
    expect(result[0].name).toBe("ai-status-probe");
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
    const result = await startCronRun("backup-nightly", "SCHEDULE");
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
    const result = await startCronRun("backup-nightly", "ADMIN_UI");
    expect(result).toEqual({ runId: "run-existing", created: false });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  // The worker's dispatchManualCronRuns only claims ADMIN_UI/ADMIN_CHAT rows. If
  // the INSERT omits the column the row defaults to UNKNOWN, so every manual
  // trigger records a RUNNING row nobody dispatches — while still holding the
  // job's lease against the real scheduled run.
  it.each(["ADMIN_UI", "ADMIN_CHAT", "SCHEDULE"] as const)(
    "persists %s as the inserted run's triggerSource",
    async (triggerSource) => {
      mockQueryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // no active lease
        .mockResolvedValueOnce([{ id: "run-abc" }]);

      await startCronRun("backup-nightly", triggerSource);

      const insertCall = mockQueryRaw.mock.calls[2] as unknown[];
      const sql = sqlTextOf(insertCall);
      expect(sql).toContain("INSERT INTO cron_job_runs");
      expect(sql).toContain('"triggerSource"');
      expect(sql).toContain('::"CronJobTriggerSource"');
      // Bind order: jobName, triggerSource, leaseOwner, leaseMs.
      expect(insertCall[1]).toBe("backup-nightly");
      expect(insertCall[2]).toBe(triggerSource);
    },
  );
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

describe("KNOWN_CRON_JOBS registry", () => {
  const invitationJob = () => KNOWN_CRON_JOBS.find((j) => j.name === "notify-invitation-expiry");

  it("registers a Core-handler job for invitation expiry reminders", () => {
    expect(invitationJob()).toMatchObject({
      script: "Core handler",
      execution: "CORE",
    });
  });

  it("schedules it daily", () => {
    expect(invitationJob()!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("does not collide with an already-occupied daily slot", () => {
    const slots = KNOWN_CRON_JOBS.filter((j) => j.name !== "notify-invitation-expiry").map(
      (j) => j.schedule,
    );
    expect(slots).not.toContain(invitationJob()!.schedule);
  });

  describe("purge-deleted-materials", () => {
    const purgeJob = () => KNOWN_CRON_JOBS.find((j) => j.name === "purge-deleted-materials");

    it("is a daily Core-handler job at 05:00 UTC", () => {
      expect(purgeJob()).toMatchObject({
        schedule: "0 5 * * *",
        scheduleLabel: "Daily at 05:00 UTC",
        script: "Core handler",
        execution: "CORE",
      });
    });

    it("declares the retainDays setting with a 90-day default", () => {
      expect(purgeJob()!.settings).toEqual([
        {
          key: "retainDays",
          label: "Delete after (days)",
          description:
            "Materials soft-deleted longer than this are permanently removed along with their embeddings and cannot be restored.",
          type: "int",
          min: 1,
          max: 3650,
          default: 90,
        },
      ]);
    });

    it("runs after backup-nightly and does not share a slot with another job", () => {
      const others = KNOWN_CRON_JOBS.filter((j) => j.name !== "purge-deleted-materials");
      expect(others.map((j) => j.schedule)).not.toContain(purgeJob()!.schedule);
    });
  });
});

describe("triggerCronJobAsync", () => {
  it("runs a Core handler without spawning a shell process", async () => {
    mockNotifyExpiringApiKeys.mockResolvedValue({ notified: 2 });
    triggerCronJobAsync("notify-api-key-expiry", "Core handler", "run-1", "owner-1", "CORE");
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

  it("routes the invitation-expiry job to the invitation reminder handler", async () => {
    mockNotifyExpiringInvitations.mockResolvedValue({ notified: 3 });
    triggerCronJobAsync("notify-invitation-expiry", "Core handler", "run-2", "owner-2", "CORE");

    await vi.waitFor(() => {
      expect(mockNotifyExpiringInvitations).toHaveBeenCalledOnce();
    });
    expect(mockNotifyExpiringApiKeys).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockExecuteRaw).toHaveBeenCalledOnce();
    });
  });

  it("routes purge-deleted-materials to the purge handler and records its summary", async () => {
    mockPurgeDeletedMaterials.mockResolvedValue({
      purged: 3,
      truncated: false,
      cutoff: new Date("2026-07-02T05:00:00.000Z"),
      retainDays: 90,
    });
    triggerCronJobAsync("purge-deleted-materials", "Core handler", "run-p", "owner-p", "CORE");

    await vi.waitFor(() => {
      expect(mockPurgeDeletedMaterials).toHaveBeenCalledOnce();
    });
    expect(mockSpawn).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockExecuteRaw).toHaveBeenCalledOnce();
    });
    expect(JSON.stringify(mockExecuteRaw.mock.calls[0])).toContain(
      "Purged 3 material(s) soft-deleted before 2026-07-02",
    );
  });

  it("reports an unknown Core job as an error instead of running the wrong handler", async () => {
    triggerCronJobAsync("not-a-core-job", "Core handler", "run-3", "owner-3", "CORE");

    await vi.waitFor(() => {
      expect(mockExecuteRaw).toHaveBeenCalledOnce();
    });
    expect(mockNotifyExpiringApiKeys).not.toHaveBeenCalled();
    expect(mockNotifyExpiringInvitations).not.toHaveBeenCalled();
  });

  it("spawns bash with the resolved script path", () => {
    const child = makeStubChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      [expect.stringContaining("backup-nightly.sh")],
      expect.any(Object),
    );
  });

  it("calls finishCronRun with SUCCESS when the script exits 0", async () => {
    const child = makeStubChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when the script exits non-zero", async () => {
    const child = makeStubChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("close", 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when spawn emits an error", async () => {
    const child = makeStubChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1", "owner-1");
    child.emit("error", new Error("ENOENT: no such file"));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("includes stdout output in the finish message", async () => {
    const child = makeStubChild();
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
    const child = makeStubChild();
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
    const child = makeStubChild();
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
    const child = makeStubChild();
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

describe("triggerCronJobAsync CORE lease heartbeat", () => {
  const PURGE_RESULT = {
    purged: 5,
    truncated: false,
    cutoff: new Date("2026-07-02T05:00:00.000Z"),
    retainDays: 90,
  };
  let originalLeaseMs: string | undefined;

  function renewCalls(): unknown[][] {
    return mockExecuteRaw.mock.calls.filter((call) =>
      sqlTextOf(call).includes('SET "leaseHeartbeatAt" = statement_timestamp()'),
    );
  }

  function finishCalls(): unknown[][] {
    return mockExecuteRaw.mock.calls.filter((call) =>
      sqlTextOf(call).includes('"finishedAt" = statement_timestamp()'),
    );
  }

  /** A handler that stays in flight until the test settles it. */
  function deferredPurge() {
    let resolvePurge: (value: typeof PURGE_RESULT) => void = () => {};
    let rejectPurge: (reason: Error) => void = () => {};
    mockPurgeDeletedMaterials.mockReturnValue(
      new Promise<typeof PURGE_RESULT>((resolve, reject) => {
        resolvePurge = resolve;
        rejectPurge = reject;
      }),
    );
    return {
      resolve: () => resolvePurge(PURGE_RESULT),
      reject: (reason: Error) => rejectPurge(reason),
    };
  }

  beforeEach(() => {
    originalLeaseMs = process.env.CRON_RUN_LEASE_MS;
    // A 15s lease heartbeats every 5s (a third of the lease).
    process.env.CRON_RUN_LEASE_MS = "15000";
    // Fake only the interval so the dynamic handler import and vi.waitFor keep real timeouts.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalLeaseMs === undefined) delete process.env.CRON_RUN_LEASE_MS;
    else process.env.CRON_RUN_LEASE_MS = originalLeaseMs;
  });

  it("renews the lease while a long Core handler runs and stops once it succeeds", async () => {
    const purge = deferredPurge();
    triggerCronJobAsync("purge-deleted-materials", "Core handler", "run-h", "owner-h", "CORE");
    await vi.waitFor(() => expect(mockPurgeDeletedMaterials).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(5_000);
    expect(renewCalls()).toHaveLength(1);
    expect(renewCalls()[0]).toEqual(expect.arrayContaining(["run-h", "owner-h"]));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(renewCalls()).toHaveLength(2);
    expect(finishCalls()).toHaveLength(0);

    purge.resolve();
    await vi.waitFor(() => expect(finishCalls()).toHaveLength(1));
    expect(finishCalls()[0][1]).toBe("SUCCESS");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(renewCalls()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops renewing once a long Core handler fails", async () => {
    const purge = deferredPurge();
    triggerCronJobAsync("purge-deleted-materials", "Core handler", "run-f", "owner-f", "CORE");
    await vi.waitFor(() => expect(mockPurgeDeletedMaterials).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(5_000);
    expect(renewCalls()).toHaveLength(1);

    purge.reject(new Error("database went away"));
    await vi.waitFor(() => expect(finishCalls()).toHaveLength(1));
    const [, status, message] = finishCalls()[0];
    expect(status).toBe("ERROR");
    expect(message).toContain("database went away");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(renewCalls()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs a warning when the run's lease was lost so its result was not recorded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPurgeDeletedMaterials.mockResolvedValue(PURGE_RESULT);
    // The finishing UPDATE matched no row: the lease expired and was reaped or taken over.
    mockExecuteRaw.mockResolvedValue(0);

    try {
      triggerCronJobAsync("purge-deleted-materials", "Core handler", "run-l", "owner-l", "CORE");

      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("result was not recorded")),
      );
      expect(finishCalls()).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("purge-deleted-materials"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("KNOWN_CRON_JOBS ai-status-probe entry", () => {
  it("registers ai-status-probe as a CORE job on the configured cadence", () => {
    const job = KNOWN_CRON_JOBS.find((j) => j.name === "ai-status-probe");

    expect(job).toBeDefined();
    expect(job?.execution).toBe("CORE");
    expect(job?.schedule).toBe("*/15 * * * *");
  });
});

describe("triggerCronJobAsync CORE handler map", () => {
  it("dispatches ai-status-probe through the CORE handler map", async () => {
    runAiStatusProbeMock.mockResolvedValue({ message: "ok" });
    triggerCronJobAsync("ai-status-probe", "Core handler", "run-1", "owner-1", "CORE");

    await vi.waitFor(() => expect(runAiStatusProbeMock).toHaveBeenCalledOnce());
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("finishes an unknown CORE job as ERROR instead of holding the lease", async () => {
    triggerCronJobAsync("does-not-exist", "Core handler", "run-2", "owner-2", "CORE");

    await vi.waitFor(() => expect(mockExecuteRaw).toHaveBeenCalledOnce());
    const [, status, message] = mockExecuteRaw.mock.calls[0] as unknown[];
    expect(status).toBe("ERROR");
    expect(message).toContain("No CORE handler");
  });
});

describe("dispatchManualCronRuns", () => {
  const coreRun: PendingRunRow = {
    id: "run-9",
    jobName: "notify-api-key-expiry",
    leaseOwner: "owner-9",
    status: "RUNNING",
    triggerSource: "ADMIN_UI",
  };

  // dispatchManualCronRuns calls triggerCronJobAsync as a same-module call,
  // which cannot be spied on cleanly. Assert the observable behaviour
  // instead: a recorded CORE run reaches its Core handler and never spawns
  // a shell script, proving the worker forwards the job's execution mode.
  it("dispatches a recorded CORE run through its Core handler, not spawn", async () => {
    seedPendingRuns([coreRun]);

    await dispatchManualCronRuns();

    await vi.waitFor(() => {
      expect(mockNotifyExpiringApiKeys).toHaveBeenCalledOnce();
    });
    expect(wasClaimed("run-9")).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("dispatches an ADMIN_CHAT run the same way", async () => {
    seedPendingRuns([{ ...coreRun, triggerSource: "ADMIN_CHAT" }]);

    await dispatchManualCronRuns();

    await vi.waitFor(() => {
      expect(mockNotifyExpiringApiKeys).toHaveBeenCalledOnce();
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  // scheduleOne dispatches its own run inline without registering it in
  // __manualCronRunIds, so a SCHEDULE row the worker also claimed would run the
  // job twice. A SCRIPT job makes that observable synchronously: spawn is called
  // inside triggerCronJobAsync, before any await.
  it("leaves a SCHEDULE run for the in-process scheduler that owns it", async () => {
    mockSpawn.mockReturnValue(makeStubChild());
    seedPendingRuns([
      { ...coreRun, id: "run-sched", jobName: "backup-nightly", triggerSource: "SCHEDULE" },
    ]);

    await dispatchManualCronRuns();
    await flushDispatch();

    expect(wasClaimed("run-sched")).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockNotifyExpiringApiKeys).not.toHaveBeenCalled();
  });

  // Rows written before the provenance column was populated default to UNKNOWN.
  it("leaves an UNKNOWN-provenance run undispatched", async () => {
    seedPendingRuns([{ ...coreRun, id: "run-unknown", triggerSource: "UNKNOWN" }]);

    await dispatchManualCronRuns();
    await flushDispatch();

    expect(wasClaimed("run-unknown")).toBe(false);
    expect(mockNotifyExpiringApiKeys).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe("cron job settings", () => {
  const JOB = "test-settings-job";

  beforeEach(() => {
    if (!KNOWN_CRON_JOBS.some((j) => j.name === JOB)) {
      KNOWN_CRON_JOBS.push({
        name: JOB,
        description: "Settings fixture",
        schedule: "7 7 * * *",
        scheduleLabel: "Daily at 07:07 UTC",
        script: "Core handler",
        execution: "CORE",
        settings: [
          {
            key: "retainDays",
            label: "Delete after (days)",
            type: "int",
            min: 1,
            max: 3650,
            default: 90,
          },
        ],
      });
    }
  });

  afterAll(() => {
    const i = KNOWN_CRON_JOBS.findIndex((j) => j.name === JOB);
    if (i >= 0) KNOWN_CRON_JOBS.splice(i, 1);
  });

  describe("getCronJobSetting", () => {
    it("returns the declared default when no override is stored", async () => {
      await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(90);
      expect(mockSettingFindUnique).toHaveBeenCalledWith({
        where: { jobName_key: { jobName: JOB, key: "retainDays" } },
      });
    });

    it("returns a valid stored override", async () => {
      mockSettingFindUnique.mockResolvedValue({ jobName: JOB, key: "retainDays", value: "30" });
      await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(30);
    });

    it.each(["0", "3651", "abc", "1.5", "", " "])(
      "falls back to the default for an invalid stored value %j",
      async (stored) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockSettingFindUnique.mockResolvedValue({ jobName: JOB, key: "retainDays", value: stored });
        await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(90);
        expect(warn).toHaveBeenCalled();
      },
    );

    it("throws for a setting the job does not declare", async () => {
      await expect(getCronJobSetting(JOB, "nope")).rejects.toThrow(/Unknown cron job setting/);
      await expect(getCronJobSetting("ghost-job", "retainDays")).rejects.toThrow(
        /Unknown cron job setting/,
      );
    });
  });

  describe("updateCronJobSetting", () => {
    it("upserts a valid value and returns the previous and new values", async () => {
      mockSettingFindUnique.mockResolvedValue({ jobName: JOB, key: "retainDays", value: "60" });
      await expect(updateCronJobSetting(JOB, "retainDays", 30, "admin-1")).resolves.toEqual({
        previous: 60,
        value: 30,
      });
      expect(mockSettingUpsert).toHaveBeenCalledWith({
        where: { jobName_key: { jobName: JOB, key: "retainDays" } },
        create: { jobName: JOB, key: "retainDays", value: "30", updatedBy: "admin-1" },
        update: { value: "30", updatedBy: "admin-1" },
      });
    });

    it("reports the default as the previous value when nothing was stored", async () => {
      await expect(updateCronJobSetting(JOB, "retainDays", 30, "admin-1")).resolves.toEqual({
        previous: 90,
        value: 30,
      });
    });

    it.each([
      [0, /between 1 and 3650/],
      [3651, /between 1 and 3650/],
      [1.5, /whole number/],
      [Number.NaN, /whole number/],
    ])("rejects %s without writing", async (value, message) => {
      const error = await updateCronJobSetting(JOB, "retainDays", value, "admin-1").catch(
        (e: Error) => e,
      );
      expect(error).toBeInstanceOf(CronJobSettingError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).toContain("Delete after (days)");
      expect(mockSettingUpsert).not.toHaveBeenCalled();
    });

    it("rejects an unknown job or key", async () => {
      await expect(updateCronJobSetting("ghost-job", "retainDays", 30, "a")).rejects.toThrow(
        "Unknown job: ghost-job",
      );
      await expect(updateCronJobSetting(JOB, "nope", 30, "a")).rejects.toThrow(
        `Unknown setting "nope" for job ${JOB}`,
      );
      expect(mockSettingUpsert).not.toHaveBeenCalled();
    });
  });

  describe("resetCronJobSetting", () => {
    it("deletes the override and returns the previous value and the default", async () => {
      mockSettingFindUnique.mockResolvedValue({ jobName: JOB, key: "retainDays", value: "30" });
      await expect(resetCronJobSetting(JOB, "retainDays")).resolves.toEqual({
        previous: 30,
        value: 90,
      });
      expect(mockSettingDeleteMany).toHaveBeenCalledWith({
        where: { jobName: JOB, key: "retainDays" },
      });
    });

    it("rejects an unknown key without deleting", async () => {
      await expect(resetCronJobSetting(JOB, "nope")).rejects.toBeInstanceOf(CronJobSettingError);
      expect(mockSettingDeleteMany).not.toHaveBeenCalled();
    });
  });

  describe("listCronJobStatuses settings", () => {
    it("attaches default settings with overridden:false", async () => {
      const jobs = await listCronJobStatuses();
      const entry = jobs.find((j) => j.name === JOB)!;
      expect(entry.settings).toEqual([
        expect.objectContaining({ key: "retainDays", value: 90, default: 90, overridden: false }),
      ]);
    });

    it("applies a stored override with overridden:true", async () => {
      mockSettingFindMany.mockResolvedValue([{ jobName: JOB, key: "retainDays", value: "30" }]);
      const jobs = await listCronJobStatuses();
      expect(jobs.find((j) => j.name === JOB)!.settings![0]).toMatchObject({
        value: 30,
        overridden: true,
      });
    });

    it("treats an invalid stored override as the default, not overridden", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockSettingFindMany.mockResolvedValue([{ jobName: JOB, key: "retainDays", value: "0" }]);
      const jobs = await listCronJobStatuses();
      expect(jobs.find((j) => j.name === JOB)!.settings![0]).toMatchObject({
        value: 90,
        overridden: false,
      });
    });

    it("leaves settings undefined on jobs that declare none", async () => {
      const jobs = await listCronJobStatuses();
      expect(jobs.find((j) => j.name === "backup-nightly")!.settings).toBeUndefined();
    });
  });
});
