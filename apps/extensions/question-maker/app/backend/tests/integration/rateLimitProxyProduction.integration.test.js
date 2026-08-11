/** Production limiter behavior through the exact Apache localhost topology. */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => {
  const config = {
    nodeEnv: 'production',
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1,
    corsOrigins: ['*'],
    coreUrl: 'http://core.test',
    extensionUrl: 'http://localhost:8000',
    encryptionKey: 'test-encryption-key-32bytes!!!!!',
    eduaiApiUrl: 'https://eduai.test',
    eduaiApiKey: 'test-key',
    eduaiIgnoredCourseCodes: [],
    logLevel: 'silent',
  };
  return { config, default: config };
});

const { default: app } = await import('../../src/app.js');

describe('production rate limiter and Apache forwarding', () => {
  it('isolates right-most Apache client addresses and excludes probes', async () => {
    const clientA = '198.51.100.10';
    const clientB = '198.51.100.11';

    const firstA = await request(app).get('/api/rate-limit-probe').set('X-Forwarded-For', clientA);
    const secondA = await request(app).get('/api/rate-limit-probe').set('X-Forwarded-For', clientA);
    const firstB = await request(app).get('/api/rate-limit-probe').set('X-Forwarded-For', clientB);
    const spoofedPrefixA = await request(app)
      .get('/api/rate-limit-probe')
      .set('X-Forwarded-For', `203.0.113.250, ${clientA}`);

    expect(firstA.status).toBe(404);
    expect(secondA.status).toBe(429);
    expect(firstB.status).toBe(404);
    expect(spoofedPrefixA.status).toBe(429);

    // A saturated user bucket must not make health/readiness unavailable.
    expect((await request(app).get('/healthz').set('X-Forwarded-For', clientA)).status).toBe(200);
    expect((await request(app).get('/').set('X-Forwarded-For', clientA)).status).toBe(200);
  });
});
