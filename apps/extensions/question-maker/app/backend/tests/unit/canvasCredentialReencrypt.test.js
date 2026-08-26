import { describe, expect, it } from "vitest";
import {
  decryptWithKey,
  encryptWithKey,
  isEncryptedBlob,
  reencryptCanvasApiKey,
} from "../../scripts/lib/canvasCredentialReencrypt.js";

const QM_KEY = "qm-encryption-key-for-tests-only!!";
const CORE_KEY = "core-encryption-key-different!!";

describe("canvasCredentialReencrypt", () => {
  it("round-trips encrypt/decrypt under one key", () => {
    const blob = encryptWithKey(QM_KEY, "canvas-token-abc");
    expect(isEncryptedBlob(blob)).toBe(true);
    expect(decryptWithKey(QM_KEY, blob)).toBe("canvas-token-abc");
  });

  it("passes through legacy plaintext", () => {
    expect(decryptWithKey(QM_KEY, "legacy-plaintext-token")).toBe("legacy-plaintext-token");
  });

  it("re-encrypts so Core can decrypt and QM cannot", () => {
    const qmBlob = encryptWithKey(QM_KEY, "secret-canvas-token");
    const coreBlob = reencryptCanvasApiKey(QM_KEY, CORE_KEY, qmBlob);

    expect(decryptWithKey(CORE_KEY, coreBlob)).toBe("secret-canvas-token");
    expect(() => decryptWithKey(QM_KEY, coreBlob)).toThrow();
  });

  it("re-encrypts legacy plaintext under the Core key", () => {
    const coreBlob = reencryptCanvasApiKey(QM_KEY, CORE_KEY, "plain-token");
    expect(decryptWithKey(CORE_KEY, coreBlob)).toBe("plain-token");
  });
});
