import { act, renderHook, waitFor } from "@testing-library/react";
import { AuthProvider, useLocalUser, type AuthUser } from "~/hooks/useLocalUser";
import api from "~/lib/api";
import { useApiKeys } from "~/hooks/use-api-keys";

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

const firstUser: AuthUser = { id: "student-a", name: "Student A", role: "STUDENT" };
const secondUser: AuthUser = { id: "student-b", name: "Student B", role: "STUDENT" };

function Wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider initialUser={firstUser}>{children}</AuthProvider>;
}

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
