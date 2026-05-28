import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useApiKeys } from "~/hooks/use-api-keys";

const STORAGE_KEY = "edu-ai-api-keys";

describe("useApiKeys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty and finishes loading", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys).toEqual({});
  });

  it("hydrates from localStorage on mount", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ openai: { apiKey: "sk-x", isEnabled: true } }),
    );
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys.openai?.apiKey).toBe("sk-x");
  });

  it("ignores invalid JSON in localStorage", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, "{not-json");
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys).toEqual({});
    expect(errSpy).toHaveBeenCalled();
  });

  it("updateProviderSettings merges and persists to localStorage", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateProviderSettings("openai", {
        apiKey: "sk-x",
        isEnabled: true,
      });
    });

    expect(result.current.apiKeys.openai).toMatchObject({
      apiKey: "sk-x",
      isEnabled: true,
    });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.openai.apiKey).toBe("sk-x");
  });

  it("updateProviderSettings preserves existing fields for the provider", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ openai: { apiKey: "sk-x", isEnabled: true } }),
    );
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateProviderSettings("openai", { isEnabled: false });
    });

    expect(result.current.apiKeys.openai?.apiKey).toBe("sk-x");
    expect(result.current.apiKeys.openai?.isEnabled).toBe(false);
  });

  it("removeProviderSettings deletes only that provider", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openai: { apiKey: "sk-x", isEnabled: true },
        google: { apiKey: "g-x", isEnabled: true },
      }),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.removeProviderSettings("openai");
    });

    expect(result.current.apiKeys.openai).toBeUndefined();
    expect(result.current.apiKeys.google?.apiKey).toBe("g-x");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.openai).toBeUndefined();
    expect(stored.google?.apiKey).toBe("g-x");
  });

  it("getValidApiKeys returns only enabled providers with keys (ollama exempt)", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openai: { apiKey: "sk-x", isEnabled: true },
        google: { apiKey: "", isEnabled: true },
        ollama: { isEnabled: true },
      }),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const valid = result.current.getValidApiKeys();
    expect(valid.openai).toBeDefined();
    expect(valid.ollama).toBeDefined();
    expect(valid.google).toBeUndefined();
  });

  it("getValidApiKeys excludes ollama when not enabled", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ollama: { isEnabled: false } }),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.getValidApiKeys().ollama).toBeUndefined();
  });

  it("isProviderConfigured handles ollama and key-required providers", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openai: { apiKey: "sk-x", isEnabled: true },
        google: { isEnabled: true },
        ollama: { isEnabled: true },
      }),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isProviderConfigured("openai")).toBe(true);
    expect(result.current.isProviderConfigured("google")).toBe(false);
    expect(result.current.isProviderConfigured("ollama")).toBe(true);
    expect(result.current.isProviderConfigured("missing")).toBe(false);
  });

  it("getProviderSettings returns the stored entry or undefined", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ openai: { apiKey: "sk-x", isEnabled: true } }),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.getProviderSettings("openai")?.apiKey).toBe("sk-x");
    expect(result.current.getProviderSettings("missing")).toBeUndefined();
  });
});
