/**
 * Integration tests for the ADMIN bug-report triage proxy routes (issue #1217):
 * GET /api/admin/bug-reports, GET /api/admin/bug-reports/:id,
 * PATCH /api/admin/bug-reports/:id — plus the POST /api/bug-reports
 * "service key not configured" branch. bugReports.integration.test.js already
 * covers the happy/error paths of the POST proxy itself.
 *
 * Auth (Core session validate) and the Core proxy calls are mocked — no live
 * Core or DB required.
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
    eduaiApiKey: 'test-service-key',
    eduaiIgnoredCourseCodes: [],
    rateLimitWindowMs: 900000,
    rateLimitMax: 1000,
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import('../../src/app.js');
const { config } = await import('../../src/config/settings.js');

const ADMIN = { id: 'cuid-admin', email: 'admin@test.com', role: 'ADMIN', name: 'Admin' };
const STUDENT = { id: 'cuid-student', email: 'student@test.com', role: 'STUDENT', name: 'Student' };

function sessionOk(user) {
  return { ok: true, json: () => Promise.resolve({ user }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  config.eduaiApiKey = 'test-service-key';
});

describe('POST /api/bug-reports — service key not configured', () => {
  it('returns 503 when eduaiApiKey is unset', async () => {
    config.eduaiApiKey = '';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk(STUDENT)));

    const res = await request(app)
      .post('/api/bug-reports')
      .set('Cookie', 'session=valid')
      .send({ description: 'test' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/bug-reports', () => {
  it('rejects non-ADMIN callers with 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(STUDENT)));

    const res = await request(app).get('/api/admin/bug-reports').set('Cookie', 'session=valid');

    expect(res.status).toBe(403);
  });

  it('forwards query params and returns Core data on success', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(sessionOk(ADMIN))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reports: [{ id: 1 }], total: 1 }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app)
      .get('/api/admin/bug-reports?status=OPEN&page=2')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { reports: [{ id: 1 }], total: 1 } });
    const forwardedUrl = mockFetch.mock.calls[1][0];
    expect(forwardedUrl).toContain('status=OPEN');
    expect(forwardedUrl).toContain('page=2');
  });

  it('ignores null/empty query values when forwarding', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(sessionOk(ADMIN))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ reports: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    await request(app).get('/api/admin/bug-reports?status=').set('Cookie', 'session=valid');

    const forwardedUrl = mockFetch.mock.calls[1][0];
    expect(forwardedUrl).not.toContain('status=');
  });

  it('passes through a non-ok Core response with its status and body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'boom' }),
      }),
    );

    const res = await request(app).get('/api/admin/bug-reports').set('Cookie', 'session=valid');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'boom' });
  });

  it('returns 502 when Core is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );

    const res = await request(app).get('/api/admin/bug-reports').set('Cookie', 'session=valid');

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/bug-reports/:id', () => {
  it('returns the report when its source is QUESTION_MAKER', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'r1', source: 'QUESTION_MAKER', consoleLogs: '...' }),
      }),
    );

    const res = await request(app).get('/api/admin/bug-reports/r1').set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('r1');
  });

  it('returns 404 when the report belongs to a different source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'r2', source: 'AI_TUTOR' }),
      }),
    );

    const res = await request(app).get('/api/admin/bug-reports/r2').set('Cookie', 'session=valid');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Bug report not found');
  });

  it('URL-encodes the id and passes through a non-ok Core response', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(sessionOk(ADMIN))
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app)
      .get('/api/admin/bug-reports/id with space')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(404);
    expect(mockFetch.mock.calls[1][0]).toContain('id%20with%20space');
  });

  it('returns 502 when Core is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );

    const res = await request(app).get('/api/admin/bug-reports/r1').set('Cookie', 'session=valid');

    expect(res.status).toBe(502);
  });
});

describe('PATCH /api/admin/bug-reports/:id', () => {
  it('forwards the body and returns Core data on success', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(sessionOk(ADMIN))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'r1', status: 'RESOLVED' }) });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app)
      .patch('/api/admin/bug-reports/r1')
      .set('Cookie', 'session=valid')
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RESOLVED');
    const [, opts] = mockFetch.mock.calls[1];
    expect(JSON.parse(opts.body)).toEqual({ status: 'RESOLVED' });
  });

  it('passes through a non-ok Core response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'bad status value' }),
      }),
    );

    const res = await request(app)
      .patch('/api/admin/bug-reports/r1')
      .set('Cookie', 'session=valid')
      .send({ status: 'NOT_A_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad status value');
  });

  it('returns 502 when Core is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sessionOk(ADMIN)).mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );

    const res = await request(app)
      .patch('/api/admin/bug-reports/r1')
      .set('Cookie', 'session=valid')
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(502);
  });

  it('rejects non-ADMIN callers with 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(STUDENT)));

    const res = await request(app)
      .patch('/api/admin/bug-reports/r1')
      .set('Cookie', 'session=valid')
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(403);
  });
});
