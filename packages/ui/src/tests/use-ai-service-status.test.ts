import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiServiceStatus, type AiServiceStatusPair } from "../hooks/use-ai-service-status";

function pair(
  cloud: AiServiceStatusPair["cloud"]["state"],
  ubc: AiServiceStatusPair["ubc"]["state"],
): AiServiceStatusPair {
  return { cloud: { state: cloud }, ubc: { state: ubc } };
}

describe("useAiServiceStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts both services as loading before the first resolution", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    expect(result.current.cloud).toEqual({ state: "loading" });
    expect(result.current.ubc).toEqual({ state: "loading" });

    // Flush the pending resolution so it doesn't leak an act() warning into
    // the next test.
    await act(() => vi.advanceTimersByTimeAsync(0));
  });

  it("applies the fetcher's result once it resolves, and polls on the interval", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "outage"));
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.cloud).toEqual({ state: "operational" });
    expect(result.current.ubc).toEqual({ state: "outage" });

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not poll again before the interval elapses", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refresh() re-checks immediately without waiting for the interval", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 60_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last known status when a poll fails", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValueOnce(pair("operational", "operational"))
      .mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.cloud).toEqual({ state: "operational" });

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Still "operational" — the failed poll did not clobber the last good status.
    expect(result.current.cloud).toEqual({ state: "operational" });
    expect(result.current.ubc).toEqual({ state: "operational" });
  });

  it("defaults intervalMs to 60s when not provided", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    renderHook(() => useAiServiceStatus({ fetcher }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops polling after unmount", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    const { unmount } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("hands the fetcher an AbortSignal so it can cancel its own network calls", async () => {
    const fetcher = vi
      .fn<(signal: AbortSignal) => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[0][0].aborted).toBe(false);
  });

  it("aborts a wedged probe after requestTimeoutMs so it cannot pin the slot", async () => {
    let captured: AbortSignal | undefined;
    const fetcher = vi.fn<(signal: AbortSignal) => Promise<AiServiceStatusPair>>((signal) => {
      captured = signal;
      // Never resolves on its own — only the timeout can end it.
      return new Promise<AiServiceStatusPair>(() => {});
    });
    renderHook(() =>
      useAiServiceStatus({ fetcher, intervalMs: 60_000, requestTimeoutMs: 1_000 }),
    );

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(captured?.aborted).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(captured?.aborted).toBe(true);
  });

  it("drops a slow response that a newer poll has already superseded", async () => {
    let resolveFirst: (() => void) | undefined;
    const fetcher = vi
      .fn<(signal: AbortSignal) => Promise<AiServiceStatusPair>>()
      // First poll hangs until we release it — by then a refresh has superseded it.
      .mockImplementationOnce(
        () =>
          new Promise<AiServiceStatusPair>((res) => {
            resolveFirst = () => res(pair("outage", "outage"));
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(pair("operational", "operational")));

    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 60_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Refresh supersedes the still-pending first poll (which the hook aborts).
    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.cloud).toEqual({ state: "operational" });

    // The stale first poll now resolves — its aborted result must be ignored.
    await act(async () => {
      resolveFirst?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.cloud).toEqual({ state: "operational" });
    expect(result.current.ubc).toEqual({ state: "operational" });
  });

  it("pauses polling in a hidden tab and fires one refresh when it becomes visible", async () => {
    const setVisibility = (state: "visible" | "hidden") => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
    };
    setVisibility("visible");

    const fetcher = vi
      .fn<(signal: AbortSignal) => Promise<AiServiceStatusPair>>()
      .mockResolvedValue(pair("operational", "operational"));
    renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Hide the tab: the armed timer is cleared and no further polls fire.
    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Re-showing the tab fires exactly one immediate refresh.
    await act(async () => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    setVisibility("visible");
  });
});
