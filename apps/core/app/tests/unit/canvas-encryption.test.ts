import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "test-encryption-key-32bytes!!";

describe("canvas encryption", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a secret string", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt } = await import("~/lib/canvas/encryption");

    const secret = "canvas-api-key-12345";
    const blob = encrypt(secret);
    expect(blob).toMatch(/^[^:]+:[^:]+:[^:]+:[^:]+$/);
    expect(decrypt(blob)).toBe(secret);
  });

  it("returns empty input unchanged", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt } = await import("~/lib/canvas/encryption");

    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });

  it("treats non-colon strings as legacy plaintext in decrypt", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { decrypt } = await import("~/lib/canvas/encryption");

    expect(decrypt("plain-key-no-colons")).toBe("plain-key-no-colons");
  });

  it("throws when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.resetModules();
    const { encrypt } = await import("~/lib/canvas/encryption");

    expect(() => encrypt("secret")).toThrow("ENCRYPTION_KEY is not set");
  });
});
