import { describe, it, expect } from 'vitest';

const cors = await import('../../src/config/cors.js');

describe('cors origin callback', () => {
  it('returns false for a missing Origin header', () => {
    cors.corsOriginCallback(undefined, (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for Origin: null', () => {
    cors.corsOriginCallback('null', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for any origin when CORS_ORIGINS is unset', () => {
    cors.corsOriginCallback('https://evil.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for localhost when CORS_ORIGINS is unset', () => {
    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for an empty string origin', () => {
    cors.corsOriginCallback('', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('does not throw for an untrusted origin', () => {
    expect(() => {
      cors.corsOriginCallback('https://evil.example.com', () => {});
    }).not.toThrow();
  });

  it('exports credentials: true', () => {
    expect(cors.corsOptions.credentials).toBe(true);
  });
});
