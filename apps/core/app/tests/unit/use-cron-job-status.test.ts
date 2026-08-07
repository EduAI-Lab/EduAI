/**
 * Unit tests for the sidebar cron-status poller (#1389).
 *
 * The hook was rewritten to stop polling while the tab is hidden and to
 * soften the "orange" cadence from 5s to 15s. These tests pin: the
 * visibility gating (no fetch while hidden, resumes on visible), the
 * orange/steady-state delay choice, and cleanup on unmount.
 *
 * Fake timers are used throughout — `advanceTimersByTimeAsync` (rather than
 * Testing Library's `waitFor`, which relies on real timers) flushes both the
 * timer queue and the microtask queue between assertions.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import type { CronJobEntry } from "~/lib/db.cron-jobs.server";
import { useCronJobStatus } from "~/hooks/api/use-cron-job-status";

function job(status: "RUNNING" | "SUCCESS" | "ERROR" | null): CronJobEntry {
  return {
    name: "backup-nightly",
    description: "",
    schedule: "",
    scheduleLabel: "",
    triggerEnabled: true,
    lastRun: status ? { id: "r1", status, startedAt: new Date().toISOString(), finishedAt: null, message: null } : null,
  } as unknown as CronJobEntry;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(apiFetch).mockReset();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCronJobStatus", () => {
  it("does not poll when disabled", async () => {
    renderHook(() => useCronJobStatus(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("polls immediately when enabled and visible", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("SUCCESS")] });
    renderHook(() => useCronJobStatus(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("schedules the next poll at 15s (not 30s) when status is orange", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("RUNNING")] });
    const { result } = renderHook(() => useCronJobStatus(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe("orange");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("schedules the next poll at 30s when status is green", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("SUCCESS")] });
    const { result } = renderHook(() => useCronJobStatus(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe("green");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a poll while the document is hidden", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("SUCCESS")] });
    renderHook(() => useCronJobStatus(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // No new fetch fired while hidden.
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("resumes polling immediately when the tab becomes visible again", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("SUCCESS")] });
    renderHook(() => useCronJobStatus(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("backs off to 60s on fetch failure", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network error"));
    renderHook(() => useCronJobStatus(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("stops polling and removes the visibility listener on unmount", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ jobs: [job("SUCCESS")] });
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useCronJobStatus(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
