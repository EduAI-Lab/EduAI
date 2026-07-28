import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete process.env.CORS_ORIGINS;
});

describe('cors config module — wildcard rejection', () => {
  it('throws when CORS_ORIGINS contains *', async () => {
    process.env.CORS_ORIGINS = 'https://example.com,*,http://localhost:3001';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS must not contain a wildcard/);
  });

  it('throws when CORS_ORIGINS is exactly *', async () => {
    process.env.CORS_ORIGINS = '*';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS must not contain a wildcard/);
  });
});

describe('cors config module — allowed origins', () => {
  it('allows an origin in the list', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3001,https://dev.aitutor.eduai.ok.ubc.ca';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });

  it('does not allow an origin not in the list', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3001';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://localhost:5173', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('deduplicates entries', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3001,http://localhost:3001,https://example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('https://example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });

  it('trims whitespace around entries', async () => {
    process.env.CORS_ORIGINS = ' http://localhost:3001 , https://example.com ';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('https://example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });
});
