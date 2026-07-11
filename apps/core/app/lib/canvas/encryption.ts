/**
 * AES-256-GCM encryption for Canvas API tokens.
 * Compatible with Question Maker format: salt:iv:tag:ciphertext (base64 segments).
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;

const STRICT_BASE64_SEGMENT = /^[A-Za-z0-9+/]+={0,2}$/;

function getEncryptionKey(): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is not set in environment variables");
  }
  return encryptionKey;
}

function deriveKey(encryptionKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

function decodeStrictBase64Segment(segment: string, expectedLength: number): Buffer | null {
  if (!STRICT_BASE64_SEGMENT.test(segment)) {
    return null;
  }

  const decoded = Buffer.from(segment, "base64");
  if (decoded.length !== expectedLength) {
    return null;
  }

  return decoded;
}

/** True when value matches our encrypted blob format (four strict base64 segments). */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 4) {
    return false;
  }

  const [saltBase64, ivBase64, tagBase64, ciphertextBase64] = parts;
  return (
    decodeStrictBase64Segment(saltBase64, SALT_LENGTH) !== null &&
    decodeStrictBase64Segment(ivBase64, IV_LENGTH) !== null &&
    decodeStrictBase64Segment(tagBase64, TAG_LENGTH) !== null &&
    STRICT_BASE64_SEGMENT.test(ciphertextBase64) &&
    Buffer.from(ciphertextBase64, "base64").length > 0
  );
}

/** Encrypts plaintext into `salt:iv:tag:ciphertext` (base64 segments). */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(getEncryptionKey(), salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return `${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypts values from `encrypt`. Legacy plaintext (not matching our blob format) is
 * returned as-is; a format match that fails to decrypt throws instead of leaking
 * ciphertext back out as a credential.
 */
export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    return encryptedData;
  }

  if (!isEncrypted(encryptedData)) {
    return encryptedData;
  }

  const parts = encryptedData.split(":");
  const [saltBase64, ivBase64, tagBase64, encrypted] = parts;

  const salt = decodeStrictBase64Segment(saltBase64, SALT_LENGTH);
  const iv = decodeStrictBase64Segment(ivBase64, IV_LENGTH);
  const tag = decodeStrictBase64Segment(tagBase64, TAG_LENGTH);

  if (!salt || !iv || !tag) {
    throw new Error("Invalid encrypted data format");
  }

  try {
    const key = deriveKey(getEncryptionKey(), salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (cause) {
    throw new Error("Failed to decrypt Canvas credential: invalid key or corrupted data", {
      cause,
    });
  }
}
