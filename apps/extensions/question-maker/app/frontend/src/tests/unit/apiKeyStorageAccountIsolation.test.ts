import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyStorage, CORE_STORED_KEY } from "@/services/apiKeyStorage";

describe("apiKeyStorage account isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    apiKeyStorage.setAuthenticatedUser(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never loads or builds a payload from user A after logout and user B login", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");
    await apiKeyStorage.setApiKey("google", "instructor-a-secret");
    expect(await apiKeyStorage.getApiKey("google")).toBe("instructor-a-secret");

    apiKeyStorage.setAuthenticatedUser(null);
    apiKeyStorage.clearApiKeysForUser("instructor-a");
    apiKeyStorage.setAuthenticatedUser("instructor-b");

    expect(await apiKeyStorage.getApiKey("google")).toBeNull();
    expect(await apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash")).toEqual({});

    apiKeyStorage.setAuthenticatedUser("instructor-a");
    expect(await apiKeyStorage.getApiKey("google")).toBeNull();
  });

  it("discards unsafe legacy global entries instead of assigning them to the next user", async () => {
    localStorage.setItem("eduai_api_key_google", "legacy-ciphertext");
    localStorage.setItem("eduai_api_key_retired-provider", "retired-ciphertext");
    localStorage.setItem("eduai_encryption_key", "legacy-salt");

    apiKeyStorage.setAuthenticatedUser("instructor-b");

    expect(await apiKeyStorage.getApiKey("google")).toBeNull();
    expect(localStorage.getItem("eduai_api_key_google")).toBeNull();
    expect(localStorage.getItem("eduai_api_key_retired-provider")).toBeNull();
    expect(localStorage.getItem("eduai_encryption_key")).toBeNull();
  });

  it("drops a provider-key read that finishes after the authenticated account changes", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");
    await apiKeyStorage.setApiKey("google", "instructor-a-secret");

    const inFlightPayload = apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash");
    apiKeyStorage.setAuthenticatedUser("instructor-b");

    await expect(inFlightPayload).resolves.toEqual({});
  });

  it("does not fall back to a stale key when the account changes during migration", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");

    // Seed a legacy-encrypted browser copy via a Core-unreachable save.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockRejectedValueOnce(new Error("Core unavailable"));
    expect(await apiKeyStorage.setApiKey("google", "instructor-a-secret")).toEqual({
      storedRemotely: false,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    let finishMigration!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishMigration = resolve;
      }),
    );

    const inFlightPayload = apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    apiKeyStorage.setAuthenticatedUser("instructor-b");
    finishMigration({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    await expect(inFlightPayload).resolves.toEqual({});
  });

  it("stores and forwards the dedicated OpenCode key for its catalog model", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-opencode");
    await apiKeyStorage.setApiKey("opencode", "opencode-secret");

    expect(await apiKeyStorage.getApiKey("opencode")).toBe("opencode-secret");
    expect(await apiKeyStorage.buildApiKeysForModel("opencode:deepseek-v4-flash")).toEqual({
      opencode: { apiKey: "opencode-secret", isEnabled: true },
    });
  });

  it("treats an authoritative Core response as the source of truth over stale local data", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");
    localStorage.setItem("eduai_api_key_v2:instructor-a:google", "stale-ciphertext");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    expect(await apiKeyStorage.getApiKey("google")).toBeNull();
    expect(await apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash")).toEqual({});
  });

  it("exposes a Core-owned enabled key as a sentinel without returning its secret", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ providerName: "google", isEnabled: true, hasKey: true, baseUrl: null }],
    } as Response);

    expect(await apiKeyStorage.getApiKey("google")).toBe(CORE_STORED_KEY);
    expect(await apiKeyStorage.getAllApiKeys()).toEqual({ google: CORE_STORED_KEY });
  });

  it("migrates a local fallback when Core answers empty, but preserves it if migration fails", async () => {
    apiKeyStorage.setAuthenticatedUser("instructor-a");

    // Seed a legacy-encrypted browser copy via a Core-unreachable save.
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    const seedResult = await apiKeyStorage.setApiKey("google", "legacy-secret");
    expect(seedResult).toEqual({ storedRemotely: false });

    // Core reachable but returns no row for this provider — migrate the
    // legacy browser copy into Core and only clear it after POST succeeds.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    expect(await apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash")).toEqual({
      google: { isEnabled: true },
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/eduai/provider-settings",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await apiKeyStorage.getApiKey("google")).toBeNull();

    // A failed migration leaves the local copy available for degraded use.
    await apiKeyStorage.setApiKey("google", "legacy-secret");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await apiKeyStorage.buildApiKeysForModel("google:gemini-2.5-flash")).toEqual({
      google: { apiKey: "legacy-secret", isEnabled: true },
    });
  });
});
