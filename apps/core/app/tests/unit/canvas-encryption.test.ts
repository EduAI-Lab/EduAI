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
    const { decrypt, isEncrypted } = await import("~/lib/canvas/encryption");

    expect(isEncrypted("plain-key-no-colons")).toBe(false);
    expect(decrypt("plain-key-no-colons")).toBe("plain-key-no-colons");
  });

  it("does not treat arbitrary colon strings as encrypted", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { isEncrypted } = await import("~/lib/canvas/encryption");

    expect(isEncrypted("not:valid:encrypted:format")).toBe(false);
  });

  it("throws when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.resetModules();
    const { encrypt } = await import("~/lib/canvas/encryption");

    expect(() => encrypt("secret")).toThrow("ENCRYPTION_KEY is not set");
  });

  it("throws instead of returning ciphertext when the key was rotated", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt } = await import("~/lib/canvas/encryption");

    const blob = encrypt("canvas-token");

    vi.stubEnv("ENCRYPTION_KEY", "a-different-encryption-key-value");
    expect(() => decrypt(blob)).toThrow();
  });

  it("throws instead of returning ciphertext when the auth tag fails verification", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt } = await import("~/lib/canvas/encryption");

    const blob = encrypt("canvas-token");
    const [salt, iv, tag, ciphertext] = blob.split(":");
    const tamperedCiphertext = Buffer.from(ciphertext, "base64");
    tamperedCiphertext[0] ^= 0xff;
    const tampered = `${salt}:${iv}:${tag}:${tamperedCiphertext.toString("base64")}`;

    expect(() => decrypt(tampered)).toThrow();
  });
});
