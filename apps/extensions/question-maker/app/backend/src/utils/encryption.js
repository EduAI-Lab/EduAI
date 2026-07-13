/**
 * Utility helpers for encrypting/decrypting sensitive strings (e.g., Canvas API keys).
 * Uses AES-256-GCM with PBKDF2-derived keys so we get authenticated encryption per value.
 * Compatible with Core's Canvas encryption format (PR #985 fail-closed decrypt).
 */
import crypto from 'crypto';
import { config } from '../config/settings.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const SALT_LENGTH = 64; // 64 bytes for salt
const TAG_LENGTH = 16; // 16 bytes for GCM tag
const KEY_LENGTH = 32; // 32 bytes for AES-256
const PBKDF2_ITERATIONS = 100000;

const STRICT_BASE64_SEGMENT = /^[A-Za-z0-9+/]+={0,2}$/;

/** Thrown when an encrypted blob fails GCM auth/decrypt (key rotation, tampering, corruption). */
export class CredentialDecryptError extends Error {
  constructor(message = 'Failed to decrypt credential', options) {
    super(message, options);
    this.name = 'CredentialDecryptError';
  }
}

/** Derives a strong key from the configured encryption key + salt via PBKDF2. */
function deriveKey(encryptionKey, salt) {
  return crypto.pbkdf2Sync(encryptionKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

function decodeStrictBase64Segment(segment, expectedLength) {
  if (!STRICT_BASE64_SEGMENT.test(segment)) {
    return null;
  }

  const decoded = Buffer.from(segment, 'base64');
  if (decoded.length !== expectedLength) {
    return null;
  }

  return decoded;
}

/** True when value matches our encrypted blob format (four strict base64 segments). */
export function isEncrypted(value) {
  const parts = value.split(':');
  if (parts.length !== 4) {
    return false;
  }

  const [saltBase64, ivBase64, tagBase64, ciphertextBase64] = parts;
  return (
    decodeStrictBase64Segment(saltBase64, SALT_LENGTH) !== null &&
    decodeStrictBase64Segment(ivBase64, IV_LENGTH) !== null &&
    decodeStrictBase64Segment(tagBase64, TAG_LENGTH) !== null &&
    STRICT_BASE64_SEGMENT.test(ciphertextBase64) &&
    Buffer.from(ciphertextBase64, 'base64').length > 0
  );
}

/** Encrypts a plaintext value into the `salt:iv:tag:data` base64 format. */
export function encrypt(plaintext) {
  if (!plaintext) {
    return plaintext;
  }

  const encryptionKey = config.encryptionKey;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not set in environment variables');
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from encryption key and salt
  const key = deriveKey(encryptionKey, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the plaintext
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get authentication tag
  const tag = cipher.getAuthTag();

  // Combine salt, iv, tag, and encrypted data
  // Format: salt:iv:tag:encryptedData (all base64 encoded)
  return `${salt.toString('base64')}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypts values produced by `encrypt`. Legacy plaintext (not matching our blob format)
 * is returned as-is; a format match that fails to decrypt throws instead of leaking
 * ciphertext back out where plaintext is expected.
 */
export function decrypt(encryptedData) {
  if (!encryptedData) {
    return encryptedData;
  }

  if (!isEncrypted(encryptedData)) {
    return encryptedData;
  }

  const encryptionKey = config.encryptionKey;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not set in environment variables');
  }

  const parts = encryptedData.split(':');
  const [saltBase64, ivBase64, tagBase64, encrypted] = parts;

  const salt = decodeStrictBase64Segment(saltBase64, SALT_LENGTH);
  const iv = decodeStrictBase64Segment(ivBase64, IV_LENGTH);
  const tag = decodeStrictBase64Segment(tagBase64, TAG_LENGTH);

  if (!salt || !iv || !tag) {
    throw new Error('Invalid encrypted data format');
  }

  try {
    const key = deriveKey(encryptionKey, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (cause) {
    throw new CredentialDecryptError(
      'Failed to decrypt credential: invalid key or corrupted data',
      { cause },
    );
  }
}
