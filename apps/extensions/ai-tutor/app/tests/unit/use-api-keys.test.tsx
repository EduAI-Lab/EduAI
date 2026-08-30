import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useLocalUser, type AuthUser } from "~/hooks/useLocalUser";
import api from "~/lib/api";
import { useApiKeys } from "~/hooks/use-api-keys";
import { getApiKeysStorageKey, saveApiKeysToStorage } from "~/lib/provider-keys";

vi.mock("~/lib/api", async () => {
  const actual = await vi.importActual<typeof import("~/lib/api")>("~/lib/api");
  return {
    ApiNetworkError: actual.ApiNetworkError,
    default: {
      me: vi.fn().mockResolvedValue({ user: null }),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
      getUserProviderSettings: vi.fn().mockRejectedValue(new Error("Core unavailable")),
      saveUserProviderSetting: vi.fn().mockResolvedValue(undefined),
      deleteUserProviderSetting: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import api from "~/lib/api";

const firstUser: AuthUser = { id: "student-a", name: "Student A", role: "STUDENT" };
const secondUser: AuthUser = { id: "student-b", name: "Student B", role: "STUDENT" };

function Wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider initialUser={firstUser}>{children}</AuthProvider>;
}

describe("useApiKeys", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.validateApiKey).mockReset().mockResolvedValue({ valid: true });
  });

  it("starts unloaded and becomes loaded after mount, hydrating from storage", async () => {
    saveApiKeysToStorage(firstUser.id, { google: "abc123" });

    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.keys).toEqual({ google: "abc123" });
    expect(result.current.hasKey("google")).toBe(true);
    expect(result.current.getKey("google")).toBe("abc123");
  });

  it("hasKey/getKey report empty for unknown providers", async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.hasKey("openai")).toBe(false);
    expect(result.current.getKey("openai")).toBe("");
  });

  it("setKey stores the key in state and localStorage", async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setKey("openai", "sk-test");
    });

    expect(result.current.keys.openai).toBe("sk-test");
    expect(JSON.parse(localStorage.getItem(getApiKeysStorageKey(firstUser.id)) ?? "{}")).toEqual({
      openai: "sk-test",
    });
  });

  it("removeKey deletes the key from state and localStorage", async () => {
    saveApiKeysToStorage(firstUser.id, { google: "abc", openai: "def" });
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.removeKey("google");
    });

    expect(result.current.keys).toEqual({ openai: "def" });
    expect(JSON.parse(localStorage.getItem(getApiKeysStorageKey(firstUser.id)) ?? "{}")).toEqual({
      openai: "def",
    });
  });

  it("validateKey delegates to api.validateApiKey", async () => {
    vi.mocked(api.validateApiKey).mockResolvedValue({ valid: true });
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const outcome = await result.current.validateKey("google", "some-key");

    expect(api.validateApiKey).toHaveBeenCalledWith("google", "some-key");
    expect(outcome).toEqual({ valid: true });
  });

  it("surfaces a validation failure result", async () => {
    vi.mocked(api.validateApiKey).mockResolvedValue({ valid: false, error: "Invalid API key" });
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const outcome = await result.current.validateKey("openai", "bad-key");
    expect(outcome).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("stores the account-scoped OpenCode key used by the dedicated model", async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.setKey("opencode", "opencode-secret");
    });

    expect(result.current.getKey("opencode")).toBe("opencode-secret");
    expect(result.current.hasKey("opencode")).toBe(true);
    expect(JSON.parse(localStorage.getItem(getApiKeysStorageKey(firstUser.id)) ?? "{}")).toEqual({
      opencode: "opencode-secret",
    });
  });
});

describe("useApiKeys account isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.getUserProviderSettings).mockRejectedValue(new Error("Core unavailable"));
    vi.mocked(api.saveUserProviderSetting).mockResolvedValue(undefined);
    vi.mocked(api.deleteUserProviderSetting).mockResolvedValue(undefined);
  });

  it("does not expose user A provider keys after logout and user B login", async () => {
    localStorage.setItem("ai-provider-keys", JSON.stringify({ google: "owner-unknown" }));
    const renderedScopes: Array<{ userId: string | null; googleKey: string }> = [];
    const { result } = renderHook(
      () => {
        const auth = useLocalUser();
        const providerKeys = useApiKeys();
        renderedScopes.push({
          userId: auth.user?.id ?? null,
          googleKey: providerKeys.getKey("google"),
        });
        return { auth, providerKeys };
      },
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.providerKeys.loaded).toBe(true));
    expect(result.current.providerKeys.getKey("google")).toBe("");
    expect(localStorage.getItem("ai-provider-keys")).toBeNull();

    act(() => {
      result.current.providerKeys.setKey("google", "student-a-secret");
    });
    expect(result.current.providerKeys.getKey("google")).toBe("student-a-secret");

    await act(async () => {
      await result.current.auth.logout();
    });
    act(() => {
      result.current.auth.saveAuth(secondUser);
    });

    await waitFor(() => expect(result.current.auth.user?.id).toBe(secondUser.id));
    await waitFor(() => expect(result.current.providerKeys.getKey("google")).toBe(""));
    expect(renderedScopes).not.toContainEqual({
      userId: secondUser.id,
      googleKey: "student-a-secret",
    });
    expect(localStorage.getItem("ai-provider-keys")).toBeNull();
  });

  it("does not expose user A keys during a direct account transition render", async () => {
    const renderedScopes: Array<{ userId: string | null; googleKey: string }> = [];
    const { result } = renderHook(
      () => {
        const auth = useLocalUser();
        const providerKeys = useApiKeys();
        renderedScopes.push({
          userId: auth.user?.id ?? null,
          googleKey: providerKeys.getKey("google"),
        });
        return { auth, providerKeys };
      },
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.providerKeys.loaded).toBe(true));

    act(() => {
      result.current.providerKeys.setKey("google", "student-a-secret");
      result.current.auth.saveAuth(secondUser);
    });

    await waitFor(() => expect(result.current.auth.user?.id).toBe(secondUser.id));
    expect(renderedScopes).not.toContainEqual({
      userId: secondUser.id,
      googleKey: "student-a-secret",
    });
  });

  it("stores the account-scoped OpenCode key used by the dedicated model", async () => {
    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.setKey("opencode", "opencode-secret");
    });

    expect(result.current.getKey("opencode")).toBe("opencode-secret");
    expect(result.current.hasKey("opencode")).toBe(true);
  });

  it("migrates an account-scoped legacy key after Core accepts it", async () => {
    localStorage.setItem(
      "ai-provider-keys:v2:student-a",
      JSON.stringify({ google: "student-a-secret" }),
    );
    vi.mocked(api.getUserProviderSettings).mockResolvedValue([]);

    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(api.saveUserProviderSetting).toHaveBeenCalledWith({
      providerName: "google",
      isEnabled: true,
      apiKey: "student-a-secret",
    });
    expect(result.current.getKey("google")).toBe("__core_stored__");
    expect(localStorage.getItem("ai-provider-keys:v2:student-a")).toBeNull();
  });

  it("rolls back the optimistic key state when the Core save rejects", async () => {
    vi.mocked(api.getUserProviderSettings).mockResolvedValue([]);
    vi.mocked(api.saveUserProviderSetting).mockRejectedValue(new Error("Core unavailable"));

    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await expect(result.current.setKey("google", "student-a-secret")).rejects.toThrow(
        "Core unavailable",
      );
    });

    expect(result.current.getKey("google")).toBe("");
    expect(result.current.hasKey("google")).toBe(false);
  });

  it("restores the previous connected value when a re-save rejects", async () => {
    vi.mocked(api.getUserProviderSettings).mockResolvedValue([
      { providerName: "google", isEnabled: true, hasKey: true, baseUrl: null },
    ]);
    vi.mocked(api.saveUserProviderSetting).mockRejectedValue(new Error("Core unavailable"));

    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.getKey("google")).toBe("__core_stored__");

    await act(async () => {
      await expect(result.current.setKey("google", "new-secret")).rejects.toThrow(
        "Core unavailable",
      );
    });

    expect(result.current.getKey("google")).toBe("__core_stored__");
  });

  it("keeps the legacy key usable when its Core migration fails", async () => {
    localStorage.setItem(
      "ai-provider-keys:v2:student-a",
      JSON.stringify({ google: "student-a-secret" }),
    );
    vi.mocked(api.getUserProviderSettings).mockResolvedValue([]);
    vi.mocked(api.saveUserProviderSetting).mockRejectedValue(new Error("Core unavailable"));

    const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.getKey("google")).toBe("student-a-secret");
    expect(localStorage.getItem("ai-provider-keys:v2:student-a")).toContain("student-a-secret");
  });
});
