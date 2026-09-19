/**
 * Unit coverage for QM's dual-status hook (#764, #1551).
 *
 * The shared `@eduai/ui` polling loop is mocked so these tests drive QM's
 * fetcher directly. As of task 14, only the CLOUD chip runs a live per-user
 * probe (`eduaiService.testApiKey` with the caller's own key) — the UBC chip
 * now reads Core's shared fleet-status snapshot via QM's own
 * `GET /api/eduai/ai-status` proxy (`eduaiService.getAiStatus`), matching
 * Core and AI Tutor. QM's old live UBC probe (`testApiKey({ forceProvider:
 * 'vllm' })`) has been deleted, so this file no longer tests that path —
 * those cases are replaced below with the proxy-passthrough and 401
 * "sign in" cases the new contract requires (see task-14-report.md for the
 * full before/after mapping).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { AiServiceStatusPair } from "@eduai/ui";
import type { ProviderApiKeys } from "@/services/apiKeyStorage";

const testApiKey = vi.fn();
const getAiStatus = vi.fn();
const getAllApiKeys = vi.fn();
const isCloudProvider = vi.fn();
const isCampusProvider = vi.fn();

vi.mock("@/services/eduaiService", () => ({
  default: {
    testApiKey: (...args: unknown[]) => testApiKey(...args),
    getAiStatus: (...args: unknown[]) => getAiStatus(...args),
  },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: { getAllApiKeys: (...args: unknown[]) => getAllApiKeys(...args) },
  CLOUD_PROVIDERS: ["google", "openai", "deepseek", "anthropic", "opencode"],
  isCloudProvider: (...args: unknown[]) => isCloudProvider(...args),
  isCampusProvider: (...args: unknown[]) => isCampusProvider(...args),
}));

// Capture the fetcher QM injects so we can drive one probe cycle deterministically
// instead of leaning on the real polling loop's timers.
let capturedFetcher: ((signal: AbortSignal) => Promise<AiServiceStatusPair>) | undefined;
let capturedIntervalMs: number | undefined;
vi.mock("@eduai/ui", () => ({
  useAiServiceStatus: (opts: {
    fetcher: (signal: AbortSignal) => Promise<AiServiceStatusPair>;
    intervalMs?: number;
  }) => {
    capturedFetcher = opts.fetcher;
    capturedIntervalMs = opts.intervalMs;
    return {
      cloud: { state: "loading" as const },
      ubc: { state: "loading" as const },
      refresh: vi.fn(),
    };
  },
}));

import { useAiServicesStatus } from "@/hooks/useAiServicesStatus";

/** Mount the hook and return the fetcher it registered with the shared loop. */
function mountAndGetFetcher() {
  renderHook(() => useAiServicesStatus());
  if (!capturedFetcher) throw new Error("fetcher was not registered");
  return capturedFetcher;
}

describe("useAiServicesStatus", () => {
  beforeEach(() => {
    testApiKey.mockReset();
    getAiStatus.mockReset().mockResolvedValue({
      cloud: { state: "operational" },
      ubc: { state: "operational", detail: "UBC-hosted AI · Online." },
      checkedAt: "2026-09-19T00:00:00.000Z",
      stale: false,
    });
    getAllApiKeys.mockReset().mockResolvedValue({});
    isCloudProvider.mockReset().mockReturnValue(false);
    isCampusProvider.mockReset().mockReturnValue(false);
    capturedFetcher = undefined;
    capturedIntervalMs = undefined;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers a 5-minute poll interval with the shared hook", () => {
    renderHook(() => useAiServicesStatus());
    expect(capturedIntervalMs).toBe(300_000);
  });

  describe("cloud probe (unchanged — still a live per-user key check)", () => {
    it("reports cloud outage when no provider key is saved", async () => {
      getAllApiKeys.mockResolvedValue({});
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toMatch(/not configured/i);
    });

    it("treats unreadable apiKeyStorage as no key configured", async () => {
      getAllApiKeys.mockRejectedValue(new Error("storage broken"));
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toMatch(/not configured/i);
    });

    it("reports cloud operational when the saved key validates as a cloud provider", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("operational");
      expect(cloud.detail).toMatch(/online/i);
    });

    it("probes only the configured provider when several cloud keys are saved", async () => {
      localStorage.setItem("qm:default-model", "openai:gpt-4o-mini");
      getAllApiKeys.mockResolvedValue({ google: "google-key", openai: "openai-key" });
      isCloudProvider.mockImplementation((provider) => provider === "openai");
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("operational");
      expect(testApiKey).toHaveBeenCalledTimes(1);
      expect(testApiKey.mock.calls[0]?.[0]).toEqual({
        openai: { apiKey: "openai-key", isEnabled: true },
      });
    });

    it("reports cloud outage when validation returns an error", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-bad" });
      testApiKey.mockResolvedValue({ success: false, error: "bad key" });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toContain("bad key");
    });

    it("reports cloud outage when the probe throws (network down)", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      testApiKey.mockRejectedValue(new Error("ECONNREFUSED"));
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toMatch(/unreachable/i);
    });

    it("forwards the poll's AbortSignal to the cloud probe (cancellation contract)", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });
      isCloudProvider.mockReturnValue(true);
      const fetcher = mountAndGetFetcher();
      const signal = new AbortController().signal;

      await fetcher(signal);

      expect(testApiKey.mock.calls[0]?.[1]?.signal).toBe(signal);
    });
  });

  describe("UBC status (new — read from Core's shared snapshot via the QM proxy)", () => {
    it("passes through the proxy's ubc/checkedAt/stale verbatim on success", async () => {
      getAiStatus.mockResolvedValue({
        cloud: { state: "outage" }, // proxy's own cloud field is ignored — QM keeps its live probe
        ubc: { state: "operational", detail: "UBC-hosted AI · Online." },
        checkedAt: "2026-09-19T01:23:00.000Z",
        stale: false,
      });
      const fetcher = mountAndGetFetcher();

      const result = await fetcher(new AbortController().signal);

      expect(result.ubc).toEqual({ state: "operational", detail: "UBC-hosted AI · Online." });
      expect(result.checkedAt).toBe("2026-09-19T01:23:00.000Z");
      expect(result.stale).toBe(false);
    });

    it("renders 'unknown' with a sign-in prompt on a 401 from the proxy, not 'outage'", async () => {
      const err: any = new Error("Unauthorized");
      err.response = { status: 401 };
      getAiStatus.mockRejectedValue(err);
      const fetcher = mountAndGetFetcher();

      const { ubc, stale } = await fetcher(new AbortController().signal);

      expect(ubc.state).toBe("unknown");
      expect(ubc.detail).toMatch(/sign in to core/i);
      expect(stale).toBe(true);
    });

    it("renders 'unknown' (not 'outage') when the proxy is unreachable for any other reason", async () => {
      getAiStatus.mockRejectedValue(new Error("network down"));
      const fetcher = mountAndGetFetcher();

      const { ubc } = await fetcher(new AbortController().signal);

      expect(ubc.state).toBe("unknown");
    });

    it("forwards the poll's AbortSignal to the proxy call (cancellation contract)", async () => {
      const fetcher = mountAndGetFetcher();
      const signal = new AbortController().signal;

      await fetcher(signal);

      expect(getAiStatus).toHaveBeenCalledWith(signal);
    });

    it("never calls the deleted UBC live probe (forceProvider: 'vllm')", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });
      isCloudProvider.mockReturnValue(true);
      const fetcher = mountAndGetFetcher();

      await fetcher(new AbortController().signal);

      const vllmCall = testApiKey.mock.calls.find((c) => c[1]?.forceProvider === "vllm");
      expect(vllmCall).toBeUndefined();
    });
  });
});
