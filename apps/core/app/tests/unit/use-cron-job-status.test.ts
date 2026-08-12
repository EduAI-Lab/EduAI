/**
 * Unit tests for the sidebar cron-job status badge poller.
 *
 * Covers: the `enabled === false` no-op, color derivation (null / green /
 * orange / red), the adaptive poll interval (5s while orange, 30s otherwise,
 * 60s after a failed fetch), and that unmounting clears the pending timer so
 * no fetch fires after the component is gone.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCronJobStatus } from "~/hooks/api/use-cron-job-status";

function jobsResponse(jobs: unknown[]) {
  return new Response(JSON.stringify({ jobs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, text: string) {
  return new Response(text, { status });
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(jobsResponse([]));
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useCronJobStatus", () => {
  it("does nothing and returns null when disabled", async () => {
    const { result } = renderHook(() => useCronJobStatus(false));

    expect(result.current).toBeNull();
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when no job has ever run", async () => {
    mockFetch.mockResolvedValue(jobsResponse([{ lastRun: null }]));

    const { result } = renderHook(() => useCronJobStatus(true));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("returns green when every job's last run succeeded", async () => {
    mockFetch.mockResolvedValue(
      jobsResponse([{ lastRun: { status: "SUCCESS" } }]),
    );

    const { result } = renderHook(() => useCronJobStatus(true));

    await waitFor(() => expect(result.current).toBe("green"));
  });

  it("returns orange when a job is currently running", async () => {
    mockFetch.mockResolvedValue(
      jobsResponse([{ lastRun: { status: "RUNNING" } }]),
    );

    const { result } = renderHook(() => useCronJobStatus(true));

    await waitFor(() => expect(result.current).toBe("orange"));
  });

  it("returns red when a job's last run errored, even if another is running", async () => {
    mockFetch.mockResolvedValue(
      jobsResponse([
        { lastRun: { status: "ERROR" } },
        { lastRun: { status: "RUNNING" } },
      ]),
    );

    const { result } = renderHook(() => useCronJobStatus(true));

    await waitFor(() => expect(result.current).toBe("red"));
  });

  it("polls again after 5s when orange, and picks up the new color", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(jobsResponse([{ lastRun: { status: "RUNNING" } }]))
      .mockResolvedValueOnce(jobsResponse([{ lastRun: { status: "SUCCESS" } }]));

    const { result } = renderHook(() => useCronJobStatus(true));

    await vi.waitFor(() => expect(result.current).toBe("orange"));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() => expect(result.current).toBe("green"));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not poll again before 30s when green", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(jobsResponse([{ lastRun: { status: "SUCCESS" } }]));

    renderHook(() => useCronJobStatus(true));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(29_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("retries after 60s on a failed fetch, without clobbering the last known color", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(jobsResponse([{ lastRun: { status: "SUCCESS" } }]));
    mockFetch.mockResolvedValueOnce(errorResponse(500, "boom"));

    const { result } = renderHook(() => useCronJobStatus(true));
    await vi.waitFor(() => expect(result.current).toBe("green"));

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // The catch branch swallows the error and keeps the previous color.
    expect(result.current).toBe("green");

    // A 60s retry, not another 30s one.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  });

  it("stops polling once unmounted", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(jobsResponse([{ lastRun: { status: "SUCCESS" } }]));

    const { unmount } = renderHook(() => useCronJobStatus(true));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
