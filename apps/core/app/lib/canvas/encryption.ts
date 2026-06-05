/**
 * AES-256-GCM encryption for Canvas API tokens.
 * Compatible with Question Maker format: salt:iv:tag:ciphertext (base64 segments).
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;

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

/** True when value looks like our encrypted blob (four base64 segments). */
export function isEncrypted(value: string): boolean {
  return value.includes(":");
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
 * Decrypts values from `encrypt`. Legacy plaintext (no colons) is returned as-is.
 */
export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    return encryptedData;
  }

  if (!isEncrypted(encryptedData)) {
    return encryptedData;
  }

  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted data format");
    }

    const [saltBase64, ivBase64, tagBase64, encrypted] = parts;
    const salt = Buffer.from(saltBase64, "base64");
    const iv = Buffer.from(ivBase64, "base64");
    const tag = Buffer.from(tagBase64, "base64");
    const key = deriveKey(getEncryptionKey(), salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // Backward compatibility: treat failed decrypt as legacy plaintext (QM behavior).
    return encryptedData;
  }
}
