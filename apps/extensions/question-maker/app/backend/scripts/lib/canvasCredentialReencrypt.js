/**
 * AES-256-GCM helpers for Canvas credential migration (QM key → Core key).
 * Same wire format as Core `encryption.ts` / QM `encryption.js`: salt:iv:tag:ciphertext.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const STRICT_BASE64_SEGMENT = /^[A-Za-z0-9+/]+={0,2}$/;

function deriveKey(encryptionKey, salt) {
  return crypto.pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

function decodeStrictBase64Segment(segment, expectedLength) {
  if (!STRICT_BASE64_SEGMENT.test(segment)) return null;
  const decoded = Buffer.from(segment, "base64");
  if (decoded.length !== expectedLength) return null;
  return decoded;
}

export function isEncryptedBlob(value) {
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

/** Decrypt with an explicit key. Legacy plaintext (non-blob) is returned as-is. */
export function decryptWithKey(encryptionKey, encryptedData) {
  if (!encryptedData) return encryptedData;
  if (!isEncryptedBlob(encryptedData)) return encryptedData;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required to decrypt Canvas credentials");
  }

  const [saltBase64, ivBase64, tagBase64, encrypted] = encryptedData.split(":");
  const salt = decodeStrictBase64Segment(saltBase64, SALT_LENGTH);
  const iv = decodeStrictBase64Segment(ivBase64, IV_LENGTH);
  const tag = decodeStrictBase64Segment(tagBase64, TAG_LENGTH);
  if (!salt || !iv || !tag) {
    throw new Error("Invalid encrypted Canvas credential format");
  }

  const key = deriveKey(encryptionKey, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function encryptWithKey(encryptionKey, plaintext) {
  if (!plaintext) return plaintext;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required to encrypt Canvas credentials");
  }

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
 * Decrypt under the QM key (or pass through legacy plaintext), then encrypt under Core's key.
 * When keys are identical this still re-wraps so Core always stores a Core-keyed blob.
 */
export function reencryptCanvasApiKey(qmEncryptionKey, coreEncryptionKey, apiKeyValue) {
  const plaintext = decryptWithKey(qmEncryptionKey, apiKeyValue);
  return encryptWithKey(coreEncryptionKey, plaintext);
}
