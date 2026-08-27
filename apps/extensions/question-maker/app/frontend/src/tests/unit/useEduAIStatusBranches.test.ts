/**
 * Additional branch coverage for `useEduAIStatus` (#1546), complementing the
 * automatic-recovery tests in `useEduAIStatus.test.ts`: the immediate success
 * path, the "needs sign-in" (configured:false) path, the cloud-key-present vs.
 * absent error-message branches, `setQuestionGenerationPhase`, and a manual
 * `refresh()` call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { EduAITestResponse } from "@/services/eduaiService";

const testApiKey = vi.fn();
const getAllApiKeys = vi.fn();
const isCloudProviderMock = vi.fn();

vi.mock("@/services/eduaiService", () => ({
  default: { testApiKey: (...args: unknown[]) => testApiKey(...args) },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: { getAllApiKeys: (...args: unknown[]) => getAllApiKeys(...args) },
  isCloudProvider: (...args: unknown[]) => isCloudProviderMock(...args),
}));

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("useEduAIStatus additional branches", () => {
  beforeEach(() => {
    vi.resetModules();
    testApiKey.mockReset();
    getAllApiKeys.mockReset().mockResolvedValue({});
    isCloudProviderMock.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("reports ok via the cloud provider message when the probe succeeds with a cloud provider", async () => {
    isCloudProviderMock.mockReturnValue(true);
    testApiKey.mockResolvedValue({ success: true, provider: "openai" });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.status).toBe("ok");
    expect(result.current.message).toMatch(/cloud provider/i);
    expect(result.current.provider).toBe("openai");
  });

  it("reports ok via the UBC-hosted message when the probe succeeds without a cloud provider", async () => {
    isCloudProviderMock.mockReturnValue(false);
    testApiKey.mockResolvedValue({ success: true, provider: "vllm" });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.message).toMatch(/UBC-hosted/i);
  });

  it("reports the needs-sign-in error when configured is false", async () => {
    testApiKey.mockResolvedValue({ success: false, configured: false });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.status).toBe("error");
    expect(result.current.message).toMatch(/Core sign-in/i);
    expect(result.current.provider).toBeUndefined();
  });

  it("surfaces the server error message when a cloud key is saved but invalid", async () => {
    getAllApiKeys.mockResolvedValue({ openai: "sk-bad" });
    testApiKey.mockResolvedValue({ success: false, error: "Invalid API key", provider: "openai" });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.message).toBe("Invalid API key");
  });

  it("falls back to a generic cloud-key-invalid message when the server gives no error text", async () => {
    getAllApiKeys.mockResolvedValue({ openai: "sk-bad" });
    testApiKey.mockResolvedValue({ success: false });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.message).toMatch(/could not be validated/i);
  });

  it("points to Settings/UBC network when no cloud key is saved and the probe fails", async () => {
    getAllApiKeys.mockResolvedValue({});
    testApiKey.mockResolvedValue({ success: false });

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.message).toMatch(/UBC-hosted AI is unavailable/i);
  });

  it("treats hasCloudKey storage errors as no key saved", async () => {
    getAllApiKeys.mockRejectedValue(new Error("blocked"));
    testApiKey.mockRejectedValue(new Error("network down"));

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.status).toBe("error");
    expect(result.current.message).toMatch(/UBC wifi\/VPN/i);
  });

  it("uses the network-check message on a thrown error when a cloud key exists", async () => {
    getAllApiKeys.mockResolvedValue({ openai: "sk-1" });
    testApiKey.mockRejectedValue(new Error("network down"));

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.message).toMatch(/Check your network/i);
  });

  it("setQuestionGenerationPhase updates state and is a no-op when unchanged", async () => {
    testApiKey.mockResolvedValue({ success: true, provider: "vllm" });
    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.questionGenerationPhase).toBeNull();

    act(() => result.current.setQuestionGenerationPhase("generating"));
    expect(result.current.questionGenerationPhase).toBe("generating");

    // Setting the same phase again is a no-op branch (state.questionGenerationPhase === phase).
    act(() => result.current.setQuestionGenerationPhase("generating"));
    expect(result.current.questionGenerationPhase).toBe("generating");
  });

  it("a manual refresh() call re-probes and can flip status back to loading first", async () => {
    testApiKey.mockResolvedValueOnce({ success: false });
    testApiKey.mockResolvedValueOnce({ success: true, provider: "vllm" });
    getAllApiKeys.mockResolvedValue({});

    const { useEduAIStatus } = await import("@/hooks/useEduAIStatus");
    await act(async () => {
      await flushMicrotasks();
    });

    const { result } = renderHook(() => useEduAIStatus());
    expect(result.current.status).toBe("error");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe("ok");
    expect(testApiKey).toHaveBeenCalledTimes(2);
  });

  it("a second concurrent refresh() call reuses the in-flight probe", async () => {
    let resolveProbe: (value: EduAITestResponse) => void = () => {};
    testApiKey.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );

    const { useEduAIStatus, refreshEduAIStatus } = await import("@/hooks/useEduAIStatus");
    // Don't await the module's own initial probe yet — its promise is still pending
    // because testApiKey's mockImplementationOnce above intercepts that first call.
    const { result } = renderHook(() => useEduAIStatus());

    const second = refreshEduAIStatus();
    resolveProbe({ success: true, provider: "vllm" });
    await act(async () => {
      await second;
      await flushMicrotasks();
    });

    expect(testApiKey).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ok");
  });
});
