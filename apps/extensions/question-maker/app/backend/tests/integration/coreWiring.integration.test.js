/**
 * No-DB integration tests for QM → Core wiring routes.
 *
 * Auth (Core session validate) and all outbound Core calls are mocked through
 * global fetch — no DB required. DB-backed tests live in coreWiringDb.integration.test.js.
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

const INSTRUCTOR = { id: 'cuid-instructor', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };

function sessionOk(user = INSTRUCTOR) {
  return { ok: true, json: () => Promise.resolve({ user }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// PATCH /api/course/:id/link-core
// ---------------------------------------------------------------------------
describe('PATCH /api/course/:id/link-core', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
    const res = await request(app).patch('/api/course/1/link-core').send({ coreCourseId: 'cuid-core' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when coreCourseId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    const res = await request(app)
      .patch('/api/course/1/link-core')
      .set('Cookie', 'session=valid')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coreCourseId/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/course/:id/sync-topics
// ---------------------------------------------------------------------------
describe('POST /api/course/:id/sync-topics', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
    const res = await request(app).post('/api/course/1/sync-topics');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/questions/variants/:variantId/testable
// ---------------------------------------------------------------------------
describe('PATCH /api/questions/variants/:variantId/testable', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
    const res = await request(app)
      .patch('/api/questions/variants/1/testable')
      .send({ testable: true });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent variant (access check precedes payload validation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    const res = await request(app)
      .patch('/api/questions/variants/999999999/testable')
      .set('Cookie', 'session=valid')
      .send({ testable: 'yes' });
    expect(res.status).toBe(404);
  });
});
