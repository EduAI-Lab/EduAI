import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useApiKeys, DB_STORED_KEY, __resetForTesting } from "~/hooks/use-api-keys";

const LEGACY_STORAGE_KEY = "edu-ai-api-keys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(rows: object[], status = 200) {
  return vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => rows,
    }),
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetForTesting();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Loading from server
// ---------------------------------------------------------------------------

describe("useApiKeys — server loading", () => {
  it("starts in loading state, resolves to empty when server returns []", async () => {
    mockFetch([]);
    const { result } = renderHook(() => useApiKeys());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys).toEqual({});
  });

  it("populates state from server rows", async () => {
    mockFetch([
      { providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null },
      { providerName: "google", isEnabled: false, hasKey: false, baseUrl: null },
    ]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.apiKeys.openai?.isEnabled).toBe(true);
    expect(result.current.apiKeys.openai?.apiKey).toBe(DB_STORED_KEY);
    expect(result.current.apiKeys.google?.isEnabled).toBe(false);
    expect(result.current.apiKeys.google?.apiKey).toBeUndefined();
  });

  it("reflects hasKey: false as no apiKey on the provider entry", async () => {
    mockFetch([{ providerName: "openai", isEnabled: true, hasKey: false, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys.openai?.apiKey).toBeUndefined();
  });

  it("reloads and clears cached provider metadata when the account changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { providerName: "google", isEnabled: true, hasKey: true, baseUrl: null },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ ownerId }) => useApiKeys(ownerId),
      { initialProps: { ownerId: "user-a" } },
    );
    await waitFor(() => expect(result.current.apiKeys.openai).toBeDefined());

    rerender({ ownerId: "user-b" });
    expect(result.current.apiKeys.openai).toBeUndefined();
    await waitFor(() => expect(result.current.apiKeys.google).toBeDefined());

    expect(result.current.apiKeys.openai).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Unsafe legacy localStorage cleanup
// ---------------------------------------------------------------------------

describe("useApiKeys — legacy localStorage cleanup", () => {
  it("deletes an unowned legacy keyset without uploading it", async () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ openai: { apiKey: "sk-local", isEnabled: true } }),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.apiKeys).toEqual({});
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/user-provider-settings",
      { credentials: "include" },
    );
  });

  it("never restores an unowned legacy key when the server is unavailable", async () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ google: { apiKey: "g-key", isEnabled: true } }),
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.apiKeys).toEqual({});
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

describe("useApiKeys — updateProviderSettings", () => {
  it("optimistically updates state and fires a POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateProviderSettings("openai", { apiKey: "sk-new", isEnabled: true });
    });

    expect(result.current.apiKeys.openai?.isEnabled).toBe(true);
    expect(result.current.apiKeys.openai?.apiKey).toBe("sk-new");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user-provider-settings",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("preserves existing apiKey when not provided in the patch", async () => {
    mockFetch([{ providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateProviderSettings("openai", { isEnabled: false });
    });

    expect(result.current.apiKeys.openai?.apiKey).toBe(DB_STORED_KEY);
    expect(result.current.apiKeys.openai?.isEnabled).toBe(false);
  });

  it("rolls back the optimistic state when the server rejects the save", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiKeys("user-a"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateProviderSettings("openai", {
        apiKey: "sk-not-saved",
        isEnabled: true,
      });
    });
    expect(result.current.apiKeys.openai?.isEnabled).toBe(true);

    await waitFor(() => expect(result.current.apiKeys.openai).toBeUndefined());
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("useApiKeys — removeProviderSettings", () => {
  it("optimistically removes the provider and fires a DELETE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null },
          { providerName: "google", isEnabled: true, hasKey: true, baseUrl: null },
        ],
      })
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.removeProviderSettings("openai");
    });

    expect(result.current.apiKeys.openai).toBeUndefined();
    expect(result.current.apiKeys.google).toBeDefined();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user-provider-settings",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("restores the provider when the server rejects the delete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null },
        ],
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiKeys("user-a"));
    await waitFor(() => expect(result.current.apiKeys.openai).toBeDefined());

    act(() => result.current.removeProviderSettings("openai"));
    expect(result.current.apiKeys.openai).toBeUndefined();

    await waitFor(() => expect(result.current.apiKeys.openai).toBeDefined());
  });
});

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

describe("useApiKeys — isProviderConfigured", () => {
  it("returns true for a DB-stored key", async () => {
    mockFetch([{ providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isProviderConfigured("openai")).toBe(true);
  });

  it("returns false when hasKey is false", async () => {
    mockFetch([{ providerName: "openai", isEnabled: true, hasKey: false, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isProviderConfigured("openai")).toBe(false);
  });

  it("returns false when isEnabled is false even with a stored key", async () => {
    mockFetch([{ providerName: "openai", isEnabled: false, hasKey: true, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isProviderConfigured("openai")).toBe(false);
  });

  it("returns true for ollama when isEnabled with no key", async () => {
    mockFetch([{ providerName: "ollama", isEnabled: true, hasKey: false, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isProviderConfigured("ollama")).toBe(true);
  });

  it("returns false for unknown provider", async () => {
    mockFetch([]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isProviderConfigured("unknown")).toBe(false);
  });
});

describe("useApiKeys — getProviderSettings", () => {
  it("returns the stored entry", async () => {
    mockFetch([{ providerName: "openai", isEnabled: true, hasKey: true, baseUrl: null }]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getProviderSettings("openai")?.isEnabled).toBe(true);
  });

  it("returns undefined for unknown provider", async () => {
    mockFetch([]);
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getProviderSettings("missing")).toBeUndefined();
  });
});
