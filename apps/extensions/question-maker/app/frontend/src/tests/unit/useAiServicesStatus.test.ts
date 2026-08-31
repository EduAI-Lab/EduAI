/**
 * Unit coverage for QM's independent dual-status hook (#1551). The shared
 * `@eduai/ui` polling loop is mocked so these tests drive QM's own cloud/UBC
 * probes directly — including the cancellation contract (the poll's AbortSignal
 * must reach each Axios probe, per the PR #1586 review).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { AiServiceStatusPair } from "@eduai/ui";
import type { ProviderApiKeys } from "@/services/apiKeyStorage";

const testApiKey = vi.fn();
const getAllApiKeys = vi.fn();
const isCloudProvider = vi.fn();
const isCampusProvider = vi.fn();

vi.mock("@/services/eduaiService", () => ({
  default: { testApiKey: (...args: unknown[]) => testApiKey(...args) },
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

describe("useAiServicesStatus probes", () => {
  beforeEach(() => {
    testApiKey.mockReset();
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

  it("reports cloud outage when no provider key is saved", async () => {
    getAllApiKeys.mockResolvedValue({});
    // UBC: server has no vLLM configured.
    testApiKey.mockResolvedValue({ configured: false });
    const fetcher = mountAndGetFetcher();

    const { cloud } = await fetcher(new AbortController().signal);

    expect(cloud.state).toBe("outage");
    expect(cloud.detail).toMatch(/not configured/i);
  });

  it("treats unreadable apiKeyStorage as no key configured", async () => {
    getAllApiKeys.mockRejectedValue(new Error("storage broken"));
    testApiKey.mockResolvedValue({ configured: false });
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
    testApiKey.mockImplementation((_keys: ProviderApiKeys, opts?: { forceProvider?: string }) =>
      opts?.forceProvider === "vllm"
        ? Promise.resolve({ configured: false })
        : Promise.resolve({ success: true, provider: "openai" }),
    );
    const fetcher = mountAndGetFetcher();

    const { cloud } = await fetcher(new AbortController().signal);

    expect(cloud.state).toBe("operational");
    const cloudCall = testApiKey.mock.calls.find((c) => !c[1]?.forceProvider);
    expect(cloudCall?.[0]).toEqual({
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
    testApiKey.mockImplementation((keys: ProviderApiKeys) => {
      // Cloud probe throws; UBC probe (forceProvider) resolves to an outage.
      if (Object.keys(keys).length > 0) return Promise.reject(new Error("ECONNREFUSED"));
      return Promise.resolve({ configured: false });
    });
    const fetcher = mountAndGetFetcher();

    const { cloud } = await fetcher(new AbortController().signal);

    expect(cloud.state).toBe("outage");
    expect(cloud.detail).toMatch(/unreachable/i);
  });

  it("reports UBC operational when the forced vLLM probe validates", async () => {
    isCampusProvider.mockReturnValue(true);
    testApiKey.mockImplementation(
      (_keys: ProviderApiKeys | undefined, opts?: { forceProvider?: string }) => {
        if (opts?.forceProvider === "vllm")
          return Promise.resolve({ success: true, provider: "vllm" });
        return Promise.resolve({ configured: false });
      },
    );
    const fetcher = mountAndGetFetcher();

    const { ubc } = await fetcher(new AbortController().signal);

    expect(ubc.state).toBe("operational");
    expect(ubc.detail).toMatch(/online/i);
  });

  it("reports UBC outage 'not configured on the server' when configured is false", async () => {
    testApiKey.mockImplementation(
      (_keys: ProviderApiKeys | undefined, opts?: { forceProvider?: string }) => {
        if (opts?.forceProvider === "vllm") return Promise.resolve({ configured: false });
        return Promise.resolve({ configured: false });
      },
    );
    const fetcher = mountAndGetFetcher();

    const { ubc } = await fetcher(new AbortController().signal);

    expect(ubc.state).toBe("outage");
    expect(ubc.detail).toMatch(/not configured on the server/i);
  });

  it("reports UBC outage when the forced vLLM probe throws", async () => {
    testApiKey.mockImplementation(
      (_keys: ProviderApiKeys | undefined, opts?: { forceProvider?: string }) => {
        if (opts?.forceProvider === "vllm") return Promise.reject(new Error("timeout"));
        return Promise.resolve({ configured: false });
      },
    );
    const fetcher = mountAndGetFetcher();

    const { ubc } = await fetcher(new AbortController().signal);

    expect(ubc.state).toBe("outage");
    expect(ubc.detail).toMatch(/unavailable/i);
  });

  it("forwards the poll's AbortSignal to both probes (cancellation contract)", async () => {
    getAllApiKeys.mockResolvedValue({ openai: "sk-x" });
    testApiKey.mockResolvedValue({ configured: false });
    const fetcher = mountAndGetFetcher();
    const signal = new AbortController().signal;

    await fetcher(signal);

    // Cloud probe: testApiKey(keys, { signal }).
    const cloudCall = testApiKey.mock.calls.find((c) => !c[1]?.forceProvider);
    // UBC probe: testApiKey({}, { forceProvider: 'vllm', signal }).
    const ubcCall = testApiKey.mock.calls.find((c) => c[1]?.forceProvider === "vllm");

    expect(cloudCall?.[1]?.signal).toBe(signal);
    expect(ubcCall?.[1]?.signal).toBe(signal);
  });
});
