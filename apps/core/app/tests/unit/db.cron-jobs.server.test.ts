// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());
const mockOverrideFindMany = vi.hoisted(() => vi.fn());
const mockOverrideUpsert = vi.hoisted(() => vi.fn());
const mockOverrideDeleteMany = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
    cronJobScheduleOverride: {
      findMany: mockOverrideFindMany,
      upsert: mockOverrideUpsert,
      deleteMany: mockOverrideDeleteMany,
    },
  },
}));

const {
  listCronJobStatuses,
  updateCronSchedule,
  resetCronSchedule,
  getRecentCronJobRuns,
  startCronRun,
  finishCronRun,
  triggerCronJobAsync,
  KNOWN_CRON_JOBS,
} = await import("~/lib/db.cron-jobs.server");

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryRaw.mockResolvedValue([]);
  mockExecuteRaw.mockResolvedValue(undefined);
  mockOverrideFindMany.mockResolvedValue([]);
  mockOverrideUpsert.mockResolvedValue({});
  mockOverrideDeleteMany.mockResolvedValue({ count: 0 });
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
      { id: "run-1", jobName: "backup-nightly", status: "SUCCESS", startedAt, finishedAt: null, message: null, exitCode: 0 },
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
      { id: "run-1", jobName: "backup-nightly", status: "SUCCESS", startedAt, finishedAt, message: "ok", exitCode: 0 },
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
      { id: "run-1", jobName: "backup-nightly", status: "SUCCESS", startedAt, finishedAt: null, message: null, exitCode: 0 },
    ]);

    const result = await listCronJobStatuses();
    const offsite = result.find((j) => j.name === "backup-offsite")!;
    expect(offsite.lastRun).toBeNull();
  });
});

describe("startCronRun", () => {
  it("returns the generated run id from INSERT", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "run-abc" }]);
    const id = await startCronRun("backup-nightly");
    expect(id).toBe("run-abc");
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it("reclaims an existing RUNNING id when INSERT conflicts (empty RETURNING)", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "run-existing" }]);
    const id = await startCronRun("backup-nightly");
    expect(id).toBe("run-existing");
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("finishCronRun", () => {
  it("executes an UPDATE with the given status, message, and exitCode", async () => {
    await finishCronRun("run-abc", "SUCCESS", "done", 0);
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("executes an UPDATE for ERROR status", async () => {
    await finishCronRun("run-abc", "ERROR", "failed", 1);
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
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
      { id: "run-1", jobName: "backup-nightly", status: "SUCCESS", startedAt, finishedAt, message: "done", exitCode: 0 },
    ]);

    const runs = await getRecentCronJobRuns("backup-nightly");
    expect(runs[0].startedAt).toBe(startedAt.toISOString());
    expect(runs[0].finishedAt).toBe(finishedAt.toISOString());
  });

  it("sets finishedAt to null when the run is still active", async () => {
    const startedAt = new Date("2026-06-20T02:00:00Z");
    mockQueryRaw.mockResolvedValue([
      { id: "run-1", jobName: "backup-nightly", status: "RUNNING", startedAt, finishedAt: null, message: null, exitCode: null },
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
      create: { jobName: "backup-nightly", schedule: "0 3 * * *", scheduleLabel: "Daily at 03:00 UTC" },
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
    return child;
  }

  it("spawns bash with the resolved script path", () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1");
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      [expect.stringContaining("backup-nightly.sh")],
      expect.any(Object),
    );
  });

  it("calls finishCronRun with SUCCESS when the script exits 0", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1");
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when the script exits non-zero", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1");
    child.emit("close", 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("calls finishCronRun with ERROR when spawn emits an error", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1");
    child.emit("error", new Error("ENOENT: no such file"));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("includes stdout output in the finish message", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    triggerCronJobAsync("backup-nightly", "backup-nightly.sh", "run-1");
    child.stdout.emit("data", Buffer.from("Backup complete"));
    child.emit("close", 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });
});
