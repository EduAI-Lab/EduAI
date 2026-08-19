/**
 * Unit tests for the AI-service status poller (#1454).
 *
 * The poller moved out of `ai-service-indicators.tsx` into a shared store that
 * stops polling while the tab is hidden. These tests pin: the visibility gating
 * (no fetch while hidden, one immediate fetch on becoming visible), request
 * sharing across consumers, and cleanup on unmount.
 *
 * Fake timers throughout — `advanceTimersByTimeAsync` flushes both the timer
 * queue and the microtask queue between assertions.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import { useAiStatus, type AiStatus } from "~/hooks/api/use-ai-status";

const POLL_MS = 60_000;

const status: AiStatus = {
  cloud: { state: "online" },
  ubc: { state: "offline", detail: "unreachable" },
};

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

describe("useAiStatus", () => {
  it("fetches immediately on mount and exposes the status", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    const { result } = renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual(status);
  });

  it("polls again after POLL_MS while visible", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS - 1_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not poll while the document is hidden", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("fires one refresh when the tab becomes visible again, then resumes the interval", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => setVisibility("hidden"));

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it("shares one request across mounted consumers", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    const first = renderHook(() => useAiStatus());
    const second = renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(second.result.current.status).toEqual(status);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);

    first.unmount();
    second.unmount();
  });

  it("keeps the last known status when a poll fails", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(status).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual(status);
  });

  it("stops polling and removes the visibility listener on unmount", async () => {
    vi.mocked(apiFetch).mockResolvedValue(status);
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useAiStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
