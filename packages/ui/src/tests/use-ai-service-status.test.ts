import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAiServiceStatus, type AiServiceStatusPair } from "../hooks/use-ai-service-status"

function pair(
  cloud: AiServiceStatusPair["cloud"]["state"],
  ubc: AiServiceStatusPair["ubc"]["state"],
): AiServiceStatusPair {
  return { cloud: { state: cloud }, ubc: { state: ubc } }
}

describe("useAiServiceStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts both services as loading before the first resolution", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "online"))
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }))

    expect(result.current.cloud).toEqual({ state: "loading" })
    expect(result.current.ubc).toEqual({ state: "loading" })

    // Flush the pending resolution so it doesn't leak an act() warning into
    // the next test.
    await act(() => vi.advanceTimersByTimeAsync(0))
  })

  it("applies the fetcher's result once it resolves, and polls on the interval", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "offline"))
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.cloud).toEqual({ state: "online" })
    expect(result.current.ubc).toEqual({ state: "offline" })

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(fetcher).toHaveBeenCalledTimes(2)

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("does not poll again before the interval elapses", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "online"))
    renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("refresh() re-checks immediately without waiting for the interval", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "online"))
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 60_000 }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("keeps the last known status when a poll fails", async () => {
    const fetcher = vi
      .fn<() => Promise<AiServiceStatusPair>>()
      .mockResolvedValueOnce(pair("online", "online"))
      .mockRejectedValueOnce(new Error("network down"))
    const { result } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.cloud).toEqual({ state: "online" })

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(fetcher).toHaveBeenCalledTimes(2)
    // Still "online" — the failed poll did not clobber the last good status.
    expect(result.current.cloud).toEqual({ state: "online" })
    expect(result.current.ubc).toEqual({ state: "online" })
  })

  it("defaults intervalMs to 60s when not provided", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "online"))
    renderHook(() => useAiServiceStatus({ fetcher }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(59_999))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("stops polling after unmount", async () => {
    const fetcher = vi.fn<() => Promise<AiServiceStatusPair>>().mockResolvedValue(pair("online", "online"))
    const { unmount } = renderHook(() => useAiServiceStatus({ fetcher, intervalMs: 1_000 }))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    unmount()
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
