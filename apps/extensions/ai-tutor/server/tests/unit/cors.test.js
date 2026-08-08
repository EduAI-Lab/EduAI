import { describe, it, expect, afterAll } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigins = process.env.CORS_ORIGINS;

process.env.NODE_ENV = 'production';
delete process.env.CORS_ORIGINS;

const cors = await import('../../src/config/cors.js');

afterAll(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins;
  }
});

describe('corsOriginCallback with empty production allowlist', () => {
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

  it('returns false for an empty string origin', () => {
    cors.corsOriginCallback('', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for an untrusted origin', () => {
    cors.corsOriginCallback('https://evil.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for localhost when unconfigured in production', () => {
    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for a prefix-match lookalike', () => {
    cors.corsOriginCallback('https://trusted.example.com.evil.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for a suffix-match lookalike', () => {
    cors.corsOriginCallback('https://evil-trusted.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for a different port on the same host', () => {
    cors.corsOriginCallback('https://trusted.example.com:444', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('returns false for a malformed incoming Origin without throwing', () => {
    expect(() => {
      cors.corsOriginCallback('not-a-valid-origin-!@#$', () => {});
    }).not.toThrow();
  });

  it('does not throw for any untrusted origin value', () => {
    expect(() => {
      cors.corsOriginCallback('https://evil.example.com', () => {});
    }).not.toThrow();
  });

  it('exports credentials: true', () => {
    expect(cors.corsOptions.credentials).toBe(true);
  });
});
