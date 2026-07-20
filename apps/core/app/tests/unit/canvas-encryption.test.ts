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

  it("round-trips multi-byte UTF-8 content correctly", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt } = await import("~/lib/canvas/encryption");

    // Non-ASCII characters only decode correctly if cipher.update/decipher.update/
    // decipher.final are called with the "utf8" encoding argument specifically —
    // an empty-string encoding argument corrupts multi-byte sequences, unlike
    // pure-ASCII content (used by the other round-trip test), which can decode
    // byte-identically under either encoding and so can't distinguish the two.
    const secret = "café-tökén-🔑-日本語";
    const blob = encrypt(secret);
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
    const { encrypt, decrypt, CanvasCredentialDecryptError } = await import(
      "~/lib/canvas/encryption"
    );

    const blob = encrypt("canvas-token");

    vi.stubEnv("ENCRYPTION_KEY", "a-different-encryption-key-value");

    let caught: unknown;
    try {
      decrypt(blob);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanvasCredentialDecryptError);
    expect((caught as Error).message).toBe(
      "Failed to decrypt Canvas credential: invalid key or corrupted data",
    );
    expect((caught as Error).cause).toBeInstanceOf(Error);
  });

  it("throws instead of returning ciphertext when the auth tag fails verification", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, decrypt, CanvasCredentialDecryptError } = await import(
      "~/lib/canvas/encryption"
    );

    const blob = encrypt("canvas-token");
    const [salt, iv, tag, ciphertext] = blob.split(":");
    const tamperedCiphertext = Buffer.from(ciphertext, "base64");
    tamperedCiphertext[0] ^= 0xff;
    const tampered = `${salt}:${iv}:${tag}:${tamperedCiphertext.toString("base64")}`;

    let caught: unknown;
    try {
      decrypt(tampered);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanvasCredentialDecryptError);
    expect((caught as Error).message).toBe(
      "Failed to decrypt Canvas credential: invalid key or corrupted data",
    );
    expect((caught as Error).cause).toBeInstanceOf(Error);
  });

  it("uses the default message and name when CanvasCredentialDecryptError is constructed without args", async () => {
    const { CanvasCredentialDecryptError } = await import("~/lib/canvas/encryption");

    const err = new CanvasCredentialDecryptError();
    expect(err.message).toBe("Failed to decrypt Canvas credential");
    expect(err.name).toBe("CanvasCredentialDecryptError");
  });

  it("rejects malformed base64 segments: invalid characters, unanchored matches, and over-padding", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { isEncrypted } = await import("~/lib/canvas/encryption");

    // invalid character ("!", " ") anywhere in the segment must fail, not just at the edges
    expect(isEncrypted("not valid!:AAAA:AAAA:AAAA")).toBe(false);
    // a valid-looking run of base64 chars surrounded by invalid ones would falsely pass an
    // unanchored regex (missing ^/$) since .test() would match the embedded substring
    expect(isEncrypted("!!!AAAAAAAAAAAA!!!:AAAA:AAAA:AAAA")).toBe(false);
    // more than the allowed {0,2} trailing '=' padding characters
    expect(isEncrypted("AAAA====:AAAA:AAAA:AAAA")).toBe(false);
    // empty segment (regex requires at least one non-padding char via '+')
    expect(isEncrypted(":AAAA:AAAA:AAAA")).toBe(false);
  });

  it("requires every segment of the encrypted format to independently be valid", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, isEncrypted } = await import("~/lib/canvas/encryption");

    const blob = encrypt("canvas-token");
    expect(isEncrypted(blob)).toBe(true);
    const [salt, iv, tag, ciphertext] = blob.split(":");

    // corrupt only the salt segment
    expect(isEncrypted(`bad!salt:${iv}:${tag}:${ciphertext}`)).toBe(false);
    // corrupt only the iv segment
    expect(isEncrypted(`${salt}:bad!iv:${tag}:${ciphertext}`)).toBe(false);
    // corrupt only the tag segment
    expect(isEncrypted(`${salt}:${iv}:bad!tag:${ciphertext}`)).toBe(false);
    // corrupt only the ciphertext segment (invalid characters)
    expect(isEncrypted(`${salt}:${iv}:${tag}:bad!ciphertext`)).toBe(false);
    // ciphertext segment that is valid base64 syntax but decodes to zero bytes
    expect(isEncrypted(`${salt}:${iv}:${tag}:A`)).toBe(false);

    // A segment with one invalid character inserted, but otherwise unchanged: Node's base64
    // decoder silently *drops* unrecognized characters rather than erroring, so decoding this
    // still yields exactly SALT_LENGTH bytes. Only the strict regex check (not the length
    // check) can reject it -- this distinguishes the regex guard from a no-op.
    const saltWithInvalidChar = `${salt.slice(0, 10)}!${salt.slice(10)}`;
    expect(isEncrypted(`${saltWithInvalidChar}:${iv}:${tag}:${ciphertext}`)).toBe(false);
  });

  it("rejects blobs with extra colon-delimited segments even when the first four are valid", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt, isEncrypted } = await import("~/lib/canvas/encryption");

    const blob = encrypt("canvas-token");
    // a 5th segment must not be silently ignored by only destructuring the first four
    expect(isEncrypted(`${blob}:extra`)).toBe(false);
  });
});
