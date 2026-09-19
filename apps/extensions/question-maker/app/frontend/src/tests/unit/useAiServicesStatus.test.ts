/**
 * Unit coverage for QM's dual-status hook (#764, #1551, task 15).
 *
 * The shared `@eduai/ui` polling loop is mocked so these tests drive QM's
 * fetcher directly.
 *
 * As of task 15, the CLOUD chip no longer runs a live per-user probe on every
 * poll — it derives its state synchronously from the cached save-time verdict
 * (`apiKeyStorage.getValidation`), which `SettingsPage` writes when a key is
 * saved and `eduaiService.generateQuestions` invalidates on a live provider
 * 401/403. The old cases that exercised a live `testApiKey` round-trip inside
 * the poll fetcher (`reports cloud operational when the saved key validates`,
 * `probes only the configured provider`, `reports cloud outage when
 * validation returns an error`, `reports cloud outage when the probe throws`,
 * `forwards the poll's AbortSignal to the cloud probe`) are replaced below
 * with cases against the cached-verdict contract — the four required states
 * (valid → operational, invalid → outage with the provider's reason, never
 * validated + a key → unknown, no key → outage) — plus new coverage for
 * `revalidateCloud`, the on-demand re-check the cloud chip's click now runs
 * instead. The UBC-side cases are unchanged from task 14 (Core's shared
 * snapshot via the QM proxy) and are not touched here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { AiServiceStatusPair } from "@eduai/ui";

const testApiKey = vi.fn();
const getAiStatus = vi.fn();
const getAllApiKeys = vi.fn();
const getValidation = vi.fn();
const setValidation = vi.fn();
const isCloudProvider = vi.fn();
const isCampusProvider = vi.fn();

vi.mock("@/services/eduaiService", () => ({
  default: {
    testApiKey: (...args: unknown[]) => testApiKey(...args),
    getAiStatus: (...args: unknown[]) => getAiStatus(...args),
  },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getAllApiKeys: (...args: unknown[]) => getAllApiKeys(...args),
    getValidation: (...args: unknown[]) => getValidation(...args),
    setValidation: (...args: unknown[]) => setValidation(...args),
  },
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

import { useAiServicesStatus, revalidateCloud } from "@/hooks/useAiServicesStatus";

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
    getValidation.mockReset().mockReturnValue({ valid: null, validatedAt: null, error: null });
    setValidation.mockReset();
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

  describe("cloud status (task 15 — synchronous read of the cached verdict, no poll-time network call)", () => {
    it("reports cloud outage when no provider key is saved", async () => {
      getAllApiKeys.mockResolvedValue({});
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toMatch(/not configured/i);
      expect(testApiKey).not.toHaveBeenCalled();
    });

    it("treats unreadable apiKeyStorage as no key configured", async () => {
      getAllApiKeys.mockRejectedValue(new Error("storage broken"));
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toMatch(/not configured/i);
    });

    it("reports operational with the cached 'checked when saved' detail when the verdict is valid", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      getValidation.mockReturnValue({
        valid: true,
        validatedAt: new Date().toISOString(),
        error: null,
      });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("operational");
      expect(cloud.detail).toMatch(/valid — checked when saved/i);
      expect(testApiKey).not.toHaveBeenCalled();
    });

    it("reports outage with the provider's own reason when the cached verdict is invalid", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-bad" });
      isCloudProvider.mockReturnValue(true);
      getValidation.mockReturnValue({
        valid: false,
        validatedAt: new Date().toISOString(),
        error: "Invalid API key",
      });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("outage");
      expect(cloud.detail).toContain("Invalid API key");
    });

    it("reports 'unknown' (not operational) for a key that has never been validated", async () => {
      // A key saved before task 15 shipped, or one whose validation write
      // failed, has no earned verdict — rendering it green would reintroduce
      // the exact lie this task removes.
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      getValidation.mockReturnValue({ valid: null, validatedAt: null, error: null });
      const fetcher = mountAndGetFetcher();

      const { cloud } = await fetcher(new AbortController().signal);

      expect(cloud.state).toBe("unknown");
      expect(cloud.detail).toMatch(/not yet verified/i);
    });

    it("probes only the configured provider's verdict when several cloud keys are saved", async () => {
      localStorage.setItem("qm:default-model", "openai:gpt-4o-mini");
      getAllApiKeys.mockResolvedValue({ google: "google-key", openai: "openai-key" });
      isCloudProvider.mockImplementation((provider) => provider === "openai");
      getValidation.mockReturnValue({ valid: true, validatedAt: null, error: null });
      const fetcher = mountAndGetFetcher();

      await fetcher(new AbortController().signal);

      expect(getValidation).toHaveBeenCalledWith("openai");
      expect(getValidation).not.toHaveBeenCalledWith("google");
    });
  });

  describe("revalidateCloud (task 15 — the cloud chip's on-demand re-check)", () => {
    it("does nothing when no cloud key is saved", async () => {
      getAllApiKeys.mockResolvedValue({});
      await revalidateCloud();
      expect(testApiKey).not.toHaveBeenCalled();
      expect(setValidation).not.toHaveBeenCalled();
    });

    it("runs the live check and caches a passing verdict", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });

      await revalidateCloud();

      expect(testApiKey).toHaveBeenCalledWith(
        { openai: { apiKey: "sk-x", isEnabled: true } },
        expect.objectContaining({ signal: undefined }),
      );
      expect(setValidation).toHaveBeenCalledWith(
        "openai",
        expect.objectContaining({ valid: true, error: null }),
      );
    });

    it("caches a failing verdict with the server's reason", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-bad" });
      isCloudProvider.mockReturnValue(true);
      testApiKey.mockResolvedValue({ success: false, error: "Invalid API key" });

      await revalidateCloud();

      expect(setValidation).toHaveBeenCalledWith(
        "openai",
        expect.objectContaining({ valid: false, error: "Invalid API key" }),
      );
    });

    it("caches a failing verdict when the round-trip itself throws (network down)", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      testApiKey.mockRejectedValue(new Error("ECONNREFUSED"));

      await revalidateCloud();

      expect(setValidation).toHaveBeenCalledWith(
        "openai",
        expect.objectContaining({ valid: false }),
      );
    });

    it("forwards the caller's AbortSignal to the live check", async () => {
      getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
      isCloudProvider.mockReturnValue(true);
      testApiKey.mockResolvedValue({ success: true, provider: "openai" });
      const signal = new AbortController().signal;

      await revalidateCloud(signal);

      expect(testApiKey.mock.calls[0]?.[1]?.signal).toBe(signal);
    });
  });

  describe("UBC status (read from Core's shared snapshot via the QM proxy — unchanged since task 14)", () => {
    it("passes through the proxy's ubc/checkedAt/stale verbatim on success", async () => {
      getAiStatus.mockResolvedValue({
        cloud: { state: "outage" }, // proxy's own cloud field is ignored — QM keeps its own cache
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

    it("passes through Core's own non-operational verdict verbatim (not just the operational case)", async () => {
      // Distinct from the 401/unreachable cases below: this is Core successfully
      // answering with a real down/unknown verdict, not a failure of the QM→Core
      // leg itself. The hook's whole job here is "pass through whatever Core
      // says" — proving that for only `operational` would leave a special-cased
      // passthrough (e.g. one that silently mangled every other state) undetected.
      getAiStatus.mockResolvedValue({
        cloud: { state: "operational" },
        ubc: { state: "outage", detail: "UBC-hosted AI · Fleet degraded." },
        checkedAt: "2026-09-19T02:00:00.000Z",
        stale: true,
      });
      const fetcher = mountAndGetFetcher();

      const result = await fetcher(new AbortController().signal);

      expect(result.ubc).toEqual({
        state: "outage",
        detail: "UBC-hosted AI · Fleet degraded.",
      });
      expect(result.checkedAt).toBe("2026-09-19T02:00:00.000Z");
      expect(result.stale).toBe(true);
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
      isCloudProvider.mockReturnValue(true);
      const fetcher = mountAndGetFetcher();

      await fetcher(new AbortController().signal);

      const vllmCall = testApiKey.mock.calls.find((c) => c[1]?.forceProvider === "vllm");
      expect(vllmCall).toBeUndefined();
    });
  });
});
