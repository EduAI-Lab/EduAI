import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAiServiceStatus } from "../hooks/use-ai-service-status";

describe("useAiServiceStatus", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          cloud: { state: "operational" },
          ubc: { state: "degraded" },
          checkedAt: "2026-09-18T20:15:00.000Z",
          stale: false,
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces checkedAt and stale from the default fetcher", async () => {
    const { result } = renderHook(() => useAiServiceStatus());

    await waitFor(() => expect(result.current.ubc.state).toBe("degraded"));
    expect(result.current.checkedAt).toBe("2026-09-18T20:15:00.000Z");
    expect(result.current.stale).toBe(false);
  });

  it("reports checkedAt as null when a custom fetcher omits it", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      cloud: { state: "operational" },
      ubc: { state: "operational" },
    });

    const { result } = renderHook(() => useAiServiceStatus({ fetcher }));

    await waitFor(() => expect(result.current.ubc.state).toBe("operational"));
    expect(result.current.checkedAt).toBeNull();
    expect(result.current.stale).toBe(false);
  });
});
