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
});
