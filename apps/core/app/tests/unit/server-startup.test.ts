// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureCronSchedulerRunningMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("~/lib/cron-scheduler.server", () => ({
  ensureCronSchedulerRunning: ensureCronSchedulerRunningMock,
}));

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  ensureCronSchedulerRunningMock.mockReset().mockResolvedValue(undefined);
  const retryTimer = (globalThis as typeof globalThis & {
    __coreServerRuntimeRetryTimer?: ReturnType<typeof setTimeout>;
  }).__coreServerRuntimeRetryTimer;
  if (retryTimer) clearTimeout(retryTimer);
  delete (globalThis as typeof globalThis & { __coreServerRuntimeStarted?: boolean })
    .__coreServerRuntimeStarted;
  delete (globalThis as typeof globalThis & {
    __coreServerRuntimeRetryTimer?: ReturnType<typeof setTimeout>;
  }).__coreServerRuntimeRetryTimer;
});

afterEach(() => {
  vi.useRealTimers();
  process.env.NODE_ENV = originalNodeEnv;
});

describe("Core server process startup", () => {
  it("starts cron from the production server entry before any HTTP request", async () => {
    process.env.NODE_ENV = "production";

    await import("~/entry.server");
    const { startCoreServerRuntime } = await import("~/lib/server-runtime.server");
    startCoreServerRuntime();
    startCoreServerRuntime();
    await Promise.resolve();

    expect(ensureCronSchedulerRunningMock).toHaveBeenCalledTimes(1);
  });

  it("keeps test imports side-effect free", async () => {
    process.env.NODE_ENV = "test";

    await import("~/entry.server");
    await Promise.resolve();

    expect(ensureCronSchedulerRunningMock).not.toHaveBeenCalled();
  });

  it("retries a failed scheduler initialization without waiting for an HTTP request", async () => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    ensureCronSchedulerRunningMock
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);

    try {
      const { startCoreServerRuntime } = await import("~/lib/server-runtime.server");
      startCoreServerRuntime();
      await Promise.resolve();
      await Promise.resolve();

      expect(ensureCronSchedulerRunningMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ensureCronSchedulerRunningMock).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(
        "[cron] Scheduler init failed:",
        expect.objectContaining({ message: "database unavailable" }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
