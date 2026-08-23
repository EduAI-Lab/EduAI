/**
 * Authenticated encryption for sensitive strings stored at rest (e.g. the admin
 * EDUAI_API_KEY override — #1571). AES-256-GCM with a PBKDF2-derived per-value
 * key, wire-compatible with Question Maker's `utils/encryption.js` and Core's
 * Canvas encryption format (`salt:iv:tag:ciphertext`, all base64).
 *
 * The key comes from `process.env.ENCRYPTION_KEY`. When it is unset, callers
 * that opt into best-effort behavior (`hasEncryptionKey()`) can store plaintext
 * so a deployment without the env var keeps working; `decrypt` treats any
 * non-four-segment value as legacy plaintext and returns it as-is, so enabling
 * the key later transparently upgrades new writes without a migration.
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

const STRICT_BASE64_SEGMENT = /^[A-Za-z0-9+/]+={0,2}$/;

/** Thrown when an encrypted blob fails GCM auth/decrypt (key rotation, tampering, corruption). */
export class CredentialDecryptError extends Error {
  constructor(message = "Failed to decrypt credential", options) {
    super(message, options);
    this.name = "CredentialDecryptError";
  }
}

/**
 * Thrown when a secret must be written but no ENCRYPTION_KEY is configured and
 * the deployment refuses to persist plaintext at rest (production). Callers map
 * this to a clear client error instead of silently storing the secret in the
 * clear (#1571 / review follow-up).
 */
export class SecretEncryptionUnavailableError extends Error {
  constructor(message = "ENCRYPTION_KEY is required to store this secret", options) {
    super(message, options);
    this.name = "SecretEncryptionUnavailableError";
  }
}

/** True when a non-empty ENCRYPTION_KEY is configured. */
export function hasEncryptionKey() {
  return Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length > 0);
}

function requireEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not set in environment variables");
  }
  return key;
}

function deriveKey(encryptionKey, salt) {
  return crypto.pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

function decodeStrictBase64Segment(segment, expectedLength) {
  if (!STRICT_BASE64_SEGMENT.test(segment)) return null;
  const decoded = Buffer.from(segment, "base64");
  if (decoded.length !== expectedLength) return null;
  return decoded;
}

/** True when value matches our encrypted blob format (four strict base64 segments). */
export function isEncrypted(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== 4) return false;
  const [saltBase64, ivBase64, tagBase64, ciphertextBase64] = parts;
  return (
    decodeStrictBase64Segment(saltBase64, SALT_LENGTH) !== null &&
    decodeStrictBase64Segment(ivBase64, IV_LENGTH) !== null &&
    decodeStrictBase64Segment(tagBase64, TAG_LENGTH) !== null &&
    STRICT_BASE64_SEGMENT.test(ciphertextBase64) &&
    Buffer.from(ciphertextBase64, "base64").length > 0
  );
}

/** Encrypts a plaintext value into the `salt:iv:tag:data` base64 format. */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;

  const encryptionKey = requireEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(encryptionKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return `${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypts values produced by `encrypt`. Legacy plaintext (not a four-segment
 * blob) is returned as-is. Four-segment values are treated as encrypted format:
 * malformed segments or GCM auth/decrypt failure throw instead of leaking
 * ciphertext.
 */
export function decrypt(encryptedData) {
  if (!encryptedData) return encryptedData;

  const parts = encryptedData.split(":");
  if (parts.length !== 4) return encryptedData; // legacy plaintext

  if (!isEncrypted(encryptedData)) {
    throw new CredentialDecryptError(
      "Failed to decrypt credential: invalid or corrupted encrypted data format",
    );
  }

  if (!hasEncryptionKey()) {
    // A four-segment blob is encrypted, but the key needed to read it is gone
    // (never set, rotated away, or lost). Surface a typed decrypt failure so
    // callers can degrade instead of a raw config Error that 500s the request.
    throw new CredentialDecryptError("Failed to decrypt credential: ENCRYPTION_KEY is not set");
  }

  const encryptionKey = requireEncryptionKey();
  const [saltBase64, ivBase64, tagBase64, encrypted] = parts;
  const salt = decodeStrictBase64Segment(saltBase64, SALT_LENGTH);
  const iv = decodeStrictBase64Segment(ivBase64, IV_LENGTH);
  const tag = decodeStrictBase64Segment(tagBase64, TAG_LENGTH);

  if (!salt || !iv || !tag) {
    throw new CredentialDecryptError(
      "Failed to decrypt credential: invalid or corrupted encrypted data format",
    );
  }

  try {
    const key = deriveKey(encryptionKey, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (cause) {
    throw new CredentialDecryptError(
      "Failed to decrypt credential: invalid key or corrupted data",
      {
        cause,
      },
    );
  }
}
