/**
 * Unit tests for AES-256-GCM helpers used for Canvas API keys.
 */
import { encrypt, decrypt } from '../src/utils/encryption.js';

describe('encrypt / decrypt', () => {
  it('round-trips a secret string', () => {
    const secret = 'canvas-api-key-12345';
    const blob = encrypt(secret);
    expect(blob).toMatch(/^[^:]+:[^:]+:[^:]+:[^:]+$/);
    expect(decrypt(blob)).toBe(secret);
  });

  it('returns empty input unchanged', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('treats non-colon strings as legacy plaintext in decrypt', () => {
    expect(decrypt('plain-key-no-colons')).toBe('plain-key-no-colons');
  });
});
