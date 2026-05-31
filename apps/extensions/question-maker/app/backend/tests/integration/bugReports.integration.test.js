/**
 * Integration tests for the QM POST /api/bug-reports proxy route.
 *
 * Auth (Core session validate) and the Core bug-reports POST are both exercised
 * through mocked global fetch — no live Core or DB required.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    port: 8000,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    coreUrl: 'http://core.test',
    extensionUrl: 'http://localhost:8000',
    encryptionKey: 'test-encryption-key-32bytes!!!!!',
    corsOrigins: ['*'],
    groqApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    eduaiApiUrl: 'https://eduai.ok.ubc.ca',
    eduaiApiKey: 'test-service-key',
    eduaiIgnoredCourseCodes: [],
    defaultNumQuestions: 15,
    maxQuestions: 50,
    rateLimitWindowMs: 900000,
    rateLimitMax: 1000,
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import('../../src/app.js');

const TEST_USER = { id: 'cuid-test-abc123', email: 'student@test.com', role: 'STUDENT', name: 'Test Student' };

function sessionOk() {
  return { ok: true, json: () => Promise.resolve({ user: TEST_USER }) };
}

function coreCreated() {
  return { ok: true, status: 201, json: () => Promise.resolve(null) };
}

describe('POST /api/bug-reports (proxy to Core)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));

    const res = await request(app).post('/api/bug-reports').send({ description: 'test' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 201 and proxies to Core on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk()).mockResolvedValueOnce(coreCreated()),
    );

    const res = await request(app)
      .post('/api/bug-reports')
      .set('Cookie', 'session=valid-token')
      .send({ description: 'The quiz page froze after clicking submit.' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('sends QUESTION_MAKER source and authenticated userId to Core', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(coreCreated());
    vi.stubGlobal('fetch', mockFetch);

    await request(app)
      .post('/api/bug-reports')
      .set('Cookie', 'session=valid-token')
      .send({ description: 'Verifying source tag and userId forwarding.' });

    const [, opts] = mockFetch.mock.calls[1];
    const body = JSON.parse(opts.body);
    expect(body.source).toBe('QUESTION_MAKER');
    expect(body.userId).toBe(TEST_USER.id);
  });

  it('passes 422 validation errors from Core through unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk()).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({ error: 'VALIDATION_ERROR', fields: { description: 'exceeds 2000 chars' } }),
      }),
    );

    const res = await request(app)
      .post('/api/bug-reports')
      .set('Cookie', 'session=valid-token')
      .send({ description: 'x'.repeat(2001) });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 502 when Core is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(sessionOk())
        .mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );

    const res = await request(app)
      .post('/api/bug-reports')
      .set('Cookie', 'session=valid-token')
      .send({ description: 'Testing Core unreachable handling.' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
