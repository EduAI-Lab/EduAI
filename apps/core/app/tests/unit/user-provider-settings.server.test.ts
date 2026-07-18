// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aIProvider: { findUnique: vi.fn() },
  userProviderSettings: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/canvas/encryption", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace(/^enc:/, "")),
}));

import {
  getUserProviderSettings,
  upsertUserProviderSetting,
  deleteUserProviderSetting,
} from "~/lib/user-provider-settings.server";
import { encrypt, decrypt } from "~/lib/canvas/encryption";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserProviderSettings", () => {
  it("returns an empty object when the user has no saved settings", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    await expect(getUserProviderSettings("u1")).resolves.toEqual({});
  });

  it("queries by the correct userId", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    await getUserProviderSettings("user-xyz");
    expect(prismaMock.userProviderSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-xyz" } }),
    );
  });

  it("maps provider name to settings with decrypted API key", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: true, apiKey: "enc:sk-abc", baseUrl: null, provider: { name: "openai" } },
    ]);
    const result = await getUserProviderSettings("u1");
    expect(result).toEqual({
      openai: { isEnabled: true, apiKey: "sk-abc", baseUrl: undefined },
    });
    expect(decrypt).toHaveBeenCalledWith("enc:sk-abc");
  });

  it("omits apiKey when no key is stored and does not call decrypt", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: false, apiKey: null, baseUrl: "http://localhost:11434", provider: { name: "ollama" } },
    ]);
    const result = await getUserProviderSettings("u1");
    expect(result.ollama?.apiKey).toBeUndefined();
    expect(result.ollama?.baseUrl).toBe("http://localhost:11434");
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("handles multiple providers in one call", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      { isEnabled: true, apiKey: "enc:k1", baseUrl: null, provider: { name: "openai" } },
      { isEnabled: false, apiKey: "enc:k2", baseUrl: null, provider: { name: "anthropic" } },
    ]);
    const result = await getUserProviderSettings("u1");
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.openai?.isEnabled).toBe(true);
    expect(result.anthropic?.isEnabled).toBe(false);
  });
});

describe("upsertUserProviderSetting", () => {
  it("throws when the provider name is not found", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue(null);
    await expect(
      upsertUserProviderSetting("u1", "unknown-provider", { isEnabled: true }),
    ).rejects.toThrow("Unknown provider: unknown-provider");
    expect(prismaMock.userProviderSettings.upsert).not.toHaveBeenCalled();
  });

  it("encrypts the API key before upserting", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.userProviderSettings.upsert.mockResolvedValue({});
    await upsertUserProviderSetting("u1", "openai", { isEnabled: true, apiKey: "sk-secret" });
    expect(encrypt).toHaveBeenCalledWith("sk-secret");
    const call = prismaMock.userProviderSettings.upsert.mock.calls[0][0];
    expect(call.create.apiKey).toBe("enc:sk-secret");
    expect(call.update.apiKey).toBe("enc:sk-secret");
  });

  it("sets apiKey to null when an empty string is provided (key removal)", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.userProviderSettings.upsert.mockResolvedValue({});
    await upsertUserProviderSetting("u1", "openai", { isEnabled: false, apiKey: "" });
    const call = prismaMock.userProviderSettings.upsert.mock.calls[0][0];
    expect(call.create.apiKey).toBeNull();
    expect(call.update.apiKey).toBeNull();
  });

  it("does not include apiKey in the update when it is undefined (preserves existing key)", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.userProviderSettings.upsert.mockResolvedValue({});
    await upsertUserProviderSetting("u1", "openai", { isEnabled: true });
    const call = prismaMock.userProviderSettings.upsert.mock.calls[0][0];
    expect("apiKey" in call.update).toBe(false);
  });

  it("uses the correct userId + providerId composite key", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "provider-42" });
    prismaMock.userProviderSettings.upsert.mockResolvedValue({});
    await upsertUserProviderSetting("user-99", "openai", { isEnabled: true });
    const call = prismaMock.userProviderSettings.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      userId_providerId: { userId: "user-99", providerId: "provider-42" },
    });
  });

  it("stores baseUrl when provided", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.userProviderSettings.upsert.mockResolvedValue({});
    await upsertUserProviderSetting("u1", "ollama", { isEnabled: true, baseUrl: "http://localhost:11434" });
    const call = prismaMock.userProviderSettings.upsert.mock.calls[0][0];
    expect(call.create.baseUrl).toBe("http://localhost:11434");
    expect(call.update.baseUrl).toBe("http://localhost:11434");
  });
});

describe("deleteUserProviderSetting", () => {
  it("does nothing when the provider is not found", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue(null);
    await deleteUserProviderSetting("u1", "unknown");
    expect(prismaMock.userProviderSettings.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the matching row when the provider exists", async () => {
    prismaMock.aIProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.userProviderSettings.deleteMany.mockResolvedValue({ count: 1 });
    await deleteUserProviderSetting("u1", "openai");
    expect(prismaMock.userProviderSettings.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", providerId: "p1" },
    });
  });
});
