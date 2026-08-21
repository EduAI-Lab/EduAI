// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleMock = vi.hoisted(() => vi.fn());
const reapExpiredCronRunsMock = vi.hoisted(() => vi.fn());
const startCronRunMock = vi.hoisted(() => vi.fn());
const triggerCronJobAsyncMock = vi.hoisted(() => vi.fn());
const overrideFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("node-cron", () => ({
  default: { schedule: scheduleMock },
}));

vi.mock("~/lib/db.cron-jobs.server", () => ({
  KNOWN_CRON_JOBS: [
    {
      name: "backup-nightly",
      schedule: "0 2 * * *",
      script: "backup-nightly.sh",
    },
    {
      name: "external-job",
      schedule: "0 3 * * *",
      script: "",
      triggerEnabled: false,
    },
  ],
  reapExpiredCronRuns: reapExpiredCronRunsMock,
  startCronRun: startCronRunMock,
  triggerCronJobAsync: triggerCronJobAsyncMock,
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    cronJobScheduleOverride: { findMany: overrideFindManyMock },
  },
}));

const { ensureCronSchedulerRunning } = await import("~/lib/cron-scheduler.server");

beforeEach(() => {
  vi.clearAllMocks();
  scheduleMock.mockReset();
  reapExpiredCronRunsMock.mockReset().mockResolvedValue(0);
  startCronRunMock.mockReset().mockResolvedValue({
    runId: "run-1",
    created: true,
    leaseOwner: "owner-1",
  });
  triggerCronJobAsyncMock.mockReset();
  overrideFindManyMock.mockReset().mockResolvedValue([]);
  delete globalThis.__cronSchedulerInitPromise;
  globalThis.__cronTasks?.forEach((task) => task.stop());
  delete globalThis.__cronTasks;
});

describe("cron scheduler initialization", () => {
  it("has no import-time scheduler or database side effects", () => {
    expect(reapExpiredCronRunsMock).not.toHaveBeenCalled();
    expect(overrideFindManyMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("shares one initialization, reaps expired leases, and schedules local jobs once", async () => {
    scheduleMock.mockReturnValue({ stop: vi.fn() });

    const first = ensureCronSchedulerRunning();
    const second = ensureCronSchedulerRunning();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(reapExpiredCronRunsMock).toHaveBeenCalledOnce();
    expect(overrideFindManyMock).toHaveBeenCalledOnce();
    expect(scheduleMock).toHaveBeenCalledOnce();
    expect(scheduleMock).toHaveBeenCalledWith("0 2 * * *", expect.any(Function), {
      timezone: "UTC",
    });
  });

  it("passes the acquired owner token to the spawned job", async () => {
    let scheduledCallback: (() => void) | undefined;
    scheduleMock.mockImplementation((_schedule, callback) => {
      scheduledCallback = callback;
      return { stop: vi.fn() };
    });

    await ensureCronSchedulerRunning();
    scheduledCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(startCronRunMock).toHaveBeenCalledWith("backup-nightly");
    expect(triggerCronJobAsyncMock).toHaveBeenCalledWith(
      "backup-nightly",
      "backup-nightly.sh",
      "run-1",
      "owner-1",
      "SCRIPT",
    );
  });

  it("clears a rejected initialization so the process runtime can retry", async () => {
    reapExpiredCronRunsMock
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(0);
    scheduleMock.mockReturnValue({ stop: vi.fn() });

    await expect(ensureCronSchedulerRunning()).rejects.toThrow("database unavailable");
    await Promise.resolve();
    await expect(ensureCronSchedulerRunning()).resolves.toBeUndefined();

    expect(reapExpiredCronRunsMock).toHaveBeenCalledTimes(2);
    expect(scheduleMock).toHaveBeenCalledOnce();
  });
});
