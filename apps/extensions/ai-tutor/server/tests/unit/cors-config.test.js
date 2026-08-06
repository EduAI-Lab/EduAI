import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigins = process.env.CORS_ORIGINS;

beforeEach(() => {
  vi.resetModules();
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
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

describe('cors config — parsing', () => {
  it.each(['development', 'test'])(
    'CORS_ORIGINS unset allows the local SPA in %s',
    async (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.CORS_ORIGINS;

      const cors = await import('../../src/config/cors.js');

      cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(true);
      });

      cors.corsOriginCallback('https://evil.example.com', (err, allowed) => {
        expect(err).toBeNull();
        expect(allowed).toBe(false);
      });
    },
  );

  it('CORS_ORIGINS unset produces an empty allowlist in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://localhost:3001', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('CORS_ORIGINS empty string produces an empty allowlist in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://a.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('whitespace-only CORS_ORIGINS produces an empty allowlist in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '   ';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://a.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('allows exactly the two configured origins', async () => {
    process.env.CORS_ORIGINS = 'http://a.com,http://b.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://a.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('http://b.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('http://c.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('trims surrounding whitespace from entries', async () => {
    process.env.CORS_ORIGINS = ' http://a.com , https://b.com ';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://a.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('https://b.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });

  it('deduplicates duplicate origins', async () => {
    process.env.CORS_ORIGINS = 'http://a.com,http://a.com,https://b.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('http://a.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    cors.corsOriginCallback('https://b.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });
});

describe('cors config — wildcard rejection', () => {
  it('rejects a standalone wildcard *', async () => {
    process.env.CORS_ORIGINS = '*';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS must not contain a wildcard/);
  });

  it('rejects a wildcard contained inside an origin', async () => {
    process.env.CORS_ORIGINS = 'https://*.example.com';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS must not contain a wildcard/);
  });
});

describe('cors config — malformed configured origins', () => {
  it('rejects a malformed URL entry', async () => {
    process.env.CORS_ORIGINS = 'not-a-valid-url-!@#';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects a non-HTTP protocol', async () => {
    process.env.CORS_ORIGINS = 'ftp://example.com';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects an entry with a non-root path', async () => {
    process.env.CORS_ORIGINS = 'https://example.com/api';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects an entry with a query string', async () => {
    process.env.CORS_ORIGINS = 'https://example.com?foo=bar';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects an entry with a fragment', async () => {
    process.env.CORS_ORIGINS = 'https://example.com#section';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects an entry with a username', async () => {
    process.env.CORS_ORIGINS = 'https://user@example.com';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });

  it('rejects an entry with username and password', async () => {
    process.env.CORS_ORIGINS = 'https://user:pass@example.com';

    await expect(async () => {
      await import('../../src/config/cors.js');
    }).rejects.toThrow(/CORS_ORIGINS contains an invalid origin/);
  });
});

describe('cors config — origin matching', () => {
  it('allows an explicitly listed origin', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://trusted.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });

  it('denies an unlisted origin', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://evil.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('denies a suffix-match lookalike (different domain)', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://trusted.example.com.evil.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('denies a prefix-match lookalike (different domain)', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://evil-trusted.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('denies a different port on the same host', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://trusted.example.com:444', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('denies a trailing slash on the incoming Origin (exact match only)', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://trusted.example.com/', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
    });
  });

  it('accepts a configured origin with trailing slash (normalized to canonical form)', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com/';

    const cors = await import('../../src/config/cors.js');

    cors.corsOriginCallback('https://trusted.example.com', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });
  });
});
