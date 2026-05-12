/**
 * Utility helpers for encrypting/decrypting sensitive strings (e.g., Canvas API keys).
 * Uses AES-256-GCM with PBKDF2-derived keys so we get authenticated encryption per value.
 */
import crypto from 'crypto';
import { config } from '../config/settings.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const SALT_LENGTH = 64; // 64 bytes for salt
const TAG_LENGTH = 16; // 16 bytes for GCM tag
const KEY_LENGTH = 32; // 32 bytes for AES-256

/** Derives a strong key from the configured encryption key + salt via PBKDF2. */
function deriveKey(encryptionKey, salt) {
  return crypto.pbkdf2Sync(encryptionKey, salt, 100000, KEY_LENGTH, 'sha512');
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

/** Decrypts values produced by `encrypt`, tolerating legacy plaintext inputs. */
export function decrypt(encryptedData) {
  if (!encryptedData) {
    return encryptedData;
  }

  // Check if the data is already in encrypted format (contains colons)
  // If not, it might be plaintext (for backward compatibility or test mode)
  if (!encryptedData.includes(':')) {
    // Assume it's plaintext (for backward compatibility or test mode)
    return encryptedData;
  }

  const encryptionKey = config.encryptionKey;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not set in environment variables');
  }

  try {
    // Split the encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const [saltBase64, ivBase64, tagBase64, encrypted] = parts;

    // Decode from base64
    const salt = Buffer.from(saltBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');

    // Derive key from encryption key and salt
    const key = deriveKey(encryptionKey, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // If decryption fails, it might be plaintext (for backward compatibility)
    // Log the error but return the original value
    console.warn('Decryption failed, assuming plaintext:', error.message);
    return encryptedData;
  }
}
