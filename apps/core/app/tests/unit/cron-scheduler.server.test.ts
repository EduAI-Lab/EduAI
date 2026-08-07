// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockScheduledTask = () => ({ stop: vi.fn(), start: vi.fn() });

const mockCronSchedule = vi.hoisted(() => vi.fn());
vi.mock("node-cron", () => ({
  default: { schedule: mockCronSchedule },
}));

const mockOverrideFindMany = vi.hoisted(() => vi.fn());
vi.mock("~/lib/prisma.server", () => ({
  default: {
    cronJobScheduleOverride: { findMany: mockOverrideFindMany },
  },
}));

const mockStartCronRun = vi.hoisted(() => vi.fn());
const mockTriggerCronJobAsync = vi.hoisted(() => vi.fn());
const mockKnownCronJobs = vi.hoisted(() => [
  {
    name: "backup-nightly",
    description: "Full pg_dump",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC",
    script: "backup-nightly.sh",
  },
  {
    name: "notify-api-key-expiry",
    description: "Email users whose API keys expire soon",
    schedule: "0 4 * * *",
    scheduleLabel: "Daily at 04:00 UTC",
    script: "Core handler",
    execution: "CORE" as const,
  },
  {
    name: "ai-tutor-reconcile",
    description: "External extension job",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC (AI Tutor server)",
    script: "",
    triggerEnabled: false,
  },
]);
vi.mock("~/lib/db.cron-jobs.server", () => ({
  KNOWN_CRON_JOBS: mockKnownCronJobs,
  startCronRun: mockStartCronRun,
  triggerCronJobAsync: mockTriggerCronJobAsync,
}));

const {
  refreshCronSchedules,
  stopCronScheduler,
} = await import("~/lib/cron-scheduler.server");

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__cronTasks = undefined;
  globalThis.__cronTaskSchedules = undefined;
  mockOverrideFindMany.mockResolvedValue([]);
  mockCronSchedule.mockImplementation(() => mockScheduledTask());
  mockStartCronRun.mockResolvedValue({ runId: "run-1", created: true });
});

describe("refreshCronSchedules", () => {
  it("schedules every job that has a script or runs inside Core, skipping external extension jobs", async () => {
    await refreshCronSchedules();

    // backup-nightly (script) + notify-api-key-expiry (CORE) = 2 scheduled tasks.
    // ai-tutor-reconcile has no script and is not CORE, so it's skipped.
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
    expect(mockCronSchedule).toHaveBeenCalledWith(
      "0 2 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
    expect(mockCronSchedule).toHaveBeenCalledWith(
      "0 4 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
  });

  it("applies a database schedule override instead of the job's default schedule", async () => {
    mockOverrideFindMany.mockResolvedValue([{ jobName: "backup-nightly", schedule: "0 5 * * *" }]);

    await refreshCronSchedules();

    expect(mockCronSchedule).toHaveBeenCalledWith(
      "0 5 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
    expect(mockCronSchedule).not.toHaveBeenCalledWith(
      "0 2 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
  });

  it("is idempotent — a second call with unchanged schedules does not re-schedule", async () => {
    await refreshCronSchedules();
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);

    mockCronSchedule.mockClear();
    await refreshCronSchedules();

    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  it("re-schedules a job when its schedule changes between calls", async () => {
    await refreshCronSchedules();
    mockCronSchedule.mockClear();

    mockOverrideFindMany.mockResolvedValue([{ jobName: "backup-nightly", schedule: "0 6 * * *" }]);
    await refreshCronSchedules();

    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    expect(mockCronSchedule).toHaveBeenCalledWith(
      "0 6 * * *",
      expect.any(Function),
      { timezone: "UTC" },
    );
  });

  it("continues scheduling remaining jobs when one job fails to schedule", async () => {
    mockCronSchedule.mockImplementationOnce(() => {
      throw new Error("bad cron expression");
    });

    await expect(refreshCronSchedules()).resolves.toBeUndefined();
    // Both jobs were still attempted even though the first threw.
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
  });

  it("invokes startCronRun with SCHEDULE source and triggers the job when the run is newly created", async () => {
    await refreshCronSchedules();

    const scheduledFn = mockCronSchedule.mock.calls[0][1] as () => void;
    scheduledFn();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockStartCronRun).toHaveBeenCalledWith("backup-nightly", { source: "SCHEDULE" });
    expect(mockTriggerCronJobAsync).toHaveBeenCalledWith(
      "backup-nightly",
      "backup-nightly.sh",
      "run-1",
      "SCRIPT",
    );
  });

  it("does not trigger the job when startCronRun reports the run was not newly created (already running)", async () => {
    mockStartCronRun.mockResolvedValue({ runId: "run-1", created: false });
    await refreshCronSchedules();

    const scheduledFn = mockCronSchedule.mock.calls[0][1] as () => void;
    scheduledFn();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTriggerCronJobAsync).not.toHaveBeenCalled();
  });
});

describe("stopCronScheduler", () => {
  it("stops and clears all scheduled tasks", async () => {
    await refreshCronSchedules();
    const task = mockCronSchedule.mock.results[0].value;

    stopCronScheduler();

    expect(task.stop).toHaveBeenCalled();

    // After stopping, refreshCronSchedules should re-schedule from scratch.
    mockCronSchedule.mockClear();
    await refreshCronSchedules();
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
  });
});
