/**
 * Unit tests for AES-256-GCM helpers used for Canvas API keys.
 */
import { encrypt, decrypt, isEncrypted, CredentialDecryptError } from '../../src/utils/encryption.js';
import { config } from '../../src/config/settings.js';

describe('encrypt / decrypt', () => {
  it('round-trips a secret string', () => {
    const secret = 'canvas-api-key-12345';
    const blob = encrypt(secret);
    expect(blob).toMatch(/^[^:]+:[^:]+:[^:]+:[^:]+$/);
    expect(isEncrypted(blob)).toBe(true);
    expect(decrypt(blob)).toBe(secret);
  });

  it('returns empty input unchanged', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('treats non-four-segment strings as legacy plaintext in decrypt', () => {
    expect(decrypt('plain-key-no-colons')).toBe('plain-key-no-colons');
    expect(decrypt('only:two:parts')).toBe('only:two:parts');
  });

  it('throws CredentialDecryptError for malformed four-segment values', () => {
    expect(isEncrypted('not:an:encrypted:blob')).toBe(false);
    expect(() => decrypt('not:an:encrypted:blob')).toThrow(CredentialDecryptError);
  });

  it('throws when corruption makes an encrypted segment malformed', () => {
    const blob = encrypt('canvas-api-key-12345');
    // Replace the first salt character with '!' so the segment fails strict base64
    // validation — isEncrypted() is false, but decrypt must still fail closed (#994).
    const tampered = `!${blob.slice(1)}`;
    expect(isEncrypted(tampered)).toBe(false);
    expect(() => decrypt(tampered)).toThrow(CredentialDecryptError);
  });

  it('throws CredentialDecryptError when ciphertext is tampered', () => {
    const blob = encrypt('canvas-api-key-12345');
    const parts = blob.split(':');
    // Flip a byte in the ciphertext segment while keeping valid encrypted format
    const cipherBuf = Buffer.from(parts[3], 'base64');
    cipherBuf[0] ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${cipherBuf.toString('base64')}`;

    expect(isEncrypted(tampered)).toBe(true);
    expect(() => decrypt(tampered)).toThrow(CredentialDecryptError);
  });

  it('throws CredentialDecryptError when the encryption key does not match', () => {
    const blob = encrypt('canvas-api-key-12345');
    const originalKey = config.encryptionKey;
    config.encryptionKey = 'a-different-encryption-key-for-failure!!';

    try {
      expect(() => decrypt(blob)).toThrow(CredentialDecryptError);
    } finally {
      config.encryptionKey = originalKey;
    }
  });
});
