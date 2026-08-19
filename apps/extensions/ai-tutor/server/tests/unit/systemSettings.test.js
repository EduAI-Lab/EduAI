import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    systemSetting: {
      findUnique: (...args) => mockFindUnique(...args),
      upsert: (...args) => mockUpsert(...args),
      delete: (...args) => mockDelete(...args),
    },
  },
}));

const {
  SYSTEM_SETTING_KEYS,
  getSystemSetting,
  setSystemSetting,
  clearSystemSetting,
  getEffectiveEduAiApiKey,
  getEduAiApiKeyStatus,
} = await import("../../src/services/systemSettings.js");

const { isEncrypted, encrypt } = await import("../../src/utils/encryption.js");

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  delete process.env.EDUAI_API_KEY;
  delete process.env.ENCRYPTION_KEY;
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

describe("getSystemSetting", () => {
  it("returns null without querying when key is falsy", async () => {
    const result = await getSystemSetting("");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("queries prisma by key", async () => {
    mockFindUnique.mockResolvedValue({ key: "K", value: "V" });
    const result = await getSystemSetting("K");
    expect(result).toEqual({ key: "K", value: "V" });
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "K" } });
  });
});

describe("setSystemSetting", () => {
  it("throws when key is missing", async () => {
    await expect(setSystemSetting("", "value")).rejects.toThrow("System setting key is required");
  });

  it("throws when value is not a string", async () => {
    await expect(setSystemSetting("K", 42)).rejects.toThrow(
      "System setting value must be a string",
    );
  });

  it("upserts key/value", async () => {
    mockUpsert.mockResolvedValue({ key: "K", value: "V" });
    const result = await setSystemSetting("K", "V");
    expect(result).toEqual({ key: "K", value: "V" });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "K" },
      update: { value: "V" },
      create: { key: "K", value: "V" },
    });
  });
});

describe("clearSystemSetting", () => {
  it("does nothing when key is falsy", async () => {
    await clearSystemSetting("");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the setting by key", async () => {
    mockDelete.mockResolvedValue({});
    await clearSystemSetting("K");
    expect(mockDelete).toHaveBeenCalledWith({ where: { key: "K" } });
  });

  it("swallows delete errors (e.g. row already gone)", async () => {
    mockDelete.mockRejectedValue(new Error("not found"));
    await expect(clearSystemSetting("K")).resolves.toBeUndefined();
  });
});

describe("getEffectiveEduAiApiKey", () => {
  it("prefers the stored admin override", async () => {
    mockFindUnique.mockResolvedValue({ value: "admin-key" });
    process.env.EDUAI_API_KEY = "env-key";
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe("admin-key");
  });

  it("falls back to the env var when no override is stored", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.EDUAI_API_KEY = "env-key";
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe("env-key");
  });

  it("returns null when neither override nor env var is set", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBeNull();
  });

  it("falls back to env when the stored row has an empty value", async () => {
    mockFindUnique.mockResolvedValue({ value: "" });
    process.env.EDUAI_API_KEY = "env-key";
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe("env-key");
  });

  it("degrades to the env key when the encrypted override can't be decrypted (key rotated away)", async () => {
    process.env.ENCRYPTION_KEY = "rotation-test-key";
    const blob = encrypt("stored-admin-key");
    expect(isEncrypted(blob)).toBe(true);
    delete process.env.ENCRYPTION_KEY; // key is now gone — blob is undecryptable
    process.env.EDUAI_API_KEY = "env-key";
    mockFindUnique.mockResolvedValue({ value: blob });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getEffectiveEduAiApiKey();

    expect(result).toBe("env-key");
    expect(warn).toHaveBeenCalled();
  });

  it("returns null when the override can't be decrypted and no env key exists", async () => {
    process.env.ENCRYPTION_KEY = "rotation-test-key";
    const blob = encrypt("stored-admin-key");
    delete process.env.ENCRYPTION_KEY;
    mockFindUnique.mockResolvedValue({ value: blob });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getEffectiveEduAiApiKey();

    expect(result).toBeNull();
  });
});

describe("getEduAiApiKeyStatus", () => {
  it("reports source ADMIN when an override is stored", async () => {
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    mockFindUnique.mockResolvedValue({ value: "admin-key", updatedAt });
    process.env.EDUAI_API_KEY = "env-key";

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: true,
      source: "ADMIN",
      hasAdminOverride: true,
      envConfigured: true,
      updatedAt: updatedAt.toISOString(),
    });
  });

  it("reports source ENV when only the env var is set", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.EDUAI_API_KEY = "env-key";

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: true,
      source: "ENV",
      hasAdminOverride: false,
      envConfigured: true,
      updatedAt: null,
    });
  });

  it("reports source NONE when nothing is configured", async () => {
    mockFindUnique.mockResolvedValue(null);

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: false,
      source: "NONE",
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });
  });

  it("exposes the known system setting keys", () => {
    expect(SYSTEM_SETTING_KEYS).toEqual({
      EDUAI_API_KEY: "EDUAI_API_KEY",
      AI_MODEL_POLICY: "AI_MODEL_POLICY",
    });
  });
});

describe("EDUAI_API_KEY encryption at rest (#1571)", () => {
  it("stores the EDUAI_API_KEY override as an encrypted blob when ENCRYPTION_KEY is set", async () => {
    process.env.ENCRYPTION_KEY = "unit-test-encryption-key";
    mockUpsert.mockResolvedValue({});

    await setSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, "super-secret-key");

    const stored = mockUpsert.mock.calls[0][0].update.value;
    expect(stored).not.toBe("super-secret-key");
    expect(isEncrypted(stored)).toBe(true);
  });

  it("round-trips: an encrypted override decrypts back to the plaintext key", async () => {
    process.env.ENCRYPTION_KEY = "unit-test-encryption-key";
    mockUpsert.mockResolvedValue({});
    await setSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, "super-secret-key");
    const stored = mockUpsert.mock.calls[0][0].update.value;

    mockFindUnique.mockResolvedValue({ value: stored });
    await expect(getEffectiveEduAiApiKey()).resolves.toBe("super-secret-key");
  });

  it("stores plaintext (best-effort) when ENCRYPTION_KEY is not set", async () => {
    mockUpsert.mockResolvedValue({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await setSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, "plain-key");

    expect(mockUpsert.mock.calls[0][0].update.value).toBe("plain-key");
    expect(warn).toHaveBeenCalled();
  });

  it("still reads legacy plaintext overrides written before encryption", async () => {
    process.env.ENCRYPTION_KEY = "unit-test-encryption-key";
    mockFindUnique.mockResolvedValue({ value: "legacy-plaintext-key" });
    await expect(getEffectiveEduAiApiKey()).resolves.toBe("legacy-plaintext-key");
  });

  it("does not encrypt non-secret setting keys (e.g. AI_MODEL_POLICY JSON)", async () => {
    process.env.ENCRYPTION_KEY = "unit-test-encryption-key";
    mockUpsert.mockResolvedValue({});
    await setSystemSetting(SYSTEM_SETTING_KEYS.AI_MODEL_POLICY, '{"a":1}');
    expect(mockUpsert.mock.calls[0][0].update.value).toBe('{"a":1}');
  });
});
