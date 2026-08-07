// @vitest-environment node
/**
 * Unit tests for the standalone cron-worker entrypoint (#1267).
 *
 * This is the new dedicated process that owns cron scheduling now that it's
 * decoupled from the Core web request path. It has side effects at import
 * time (starts a refresh loop, registers SIGINT/SIGTERM handlers), so these
 * tests import it fresh per case and assert on the wiring rather than on a
 * long-running process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefreshCronSchedules = vi.hoisted(() => vi.fn());
const mockStopCronScheduler = vi.hoisted(() => vi.fn());
vi.mock("~/lib/cron-scheduler.server", () => ({
  refreshCronSchedules: mockRefreshCronSchedules,
  stopCronScheduler: mockStopCronScheduler,
}));

const mockDisconnect = vi.hoisted(() => vi.fn());
vi.mock("~/lib/prisma.server", () => ({
  default: { $disconnect: mockDisconnect },
}));

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }));
vi.mock("node:process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:process")>();
  return { ...actual, loadEnvFile: vi.fn() };
});

/** process.once handlers registered by the module, captured so tests can invoke them directly. */
function captureSignalHandlers() {
  const handlers: Record<string, () => void> = {};
  const onceSpy = vi.spyOn(process, "once").mockImplementation(((event: string, cb: () => void) => {
    handlers[event] = cb;
    return process;
  }) as typeof process.once);
  return { handlers, onceSpy };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockRefreshCronSchedules.mockReset().mockResolvedValue(undefined);
  mockStopCronScheduler.mockReset();
  mockDisconnect.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cron-worker script", () => {
  it("refreshes schedules once on startup", async () => {
    captureSignalHandlers();
    await import("../../../scripts/cron-worker");
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(1));
  });

  it("reconciles schedules every 30 seconds", async () => {
    captureSignalHandlers();
    await import("../../../scripts/cron-worker");
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(3);
  });

  it("logs and continues when a periodic refresh fails", async () => {
    captureSignalHandlers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRefreshCronSchedules.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db down"));

    await import("../../../scripts/cron-worker");
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(2));
    expect(errorSpy).toHaveBeenCalledWith("[cron-worker] schedule refresh failed", expect.any(Error));

    // The interval keeps running after a failed refresh.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(3);
  });

  it("stops the scheduler, disconnects prisma, and clears the timer on SIGTERM", async () => {
    const { handlers } = captureSignalHandlers();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../../../scripts/cron-worker");
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(1));

    expect(handlers.SIGTERM).toBeTypeOf("function");
    await handlers.SIGTERM();
    await vi.waitFor(() => expect(mockStopCronScheduler).toHaveBeenCalledTimes(1));
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    // Shutdown clears the reconcile interval — no further refreshes fire.
    mockRefreshCronSchedules.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRefreshCronSchedules).not.toHaveBeenCalled();
  });

  it("is idempotent if both SIGINT and SIGTERM fire", async () => {
    const { handlers } = captureSignalHandlers();
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../../../scripts/cron-worker");
    await vi.waitFor(() => expect(mockRefreshCronSchedules).toHaveBeenCalledTimes(1));

    await handlers.SIGTERM();
    await handlers.SIGINT();

    // stopCronScheduler / disconnect only run once even though two signals fired.
    expect(mockStopCronScheduler).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
