/**
 * Integration tests for GET /api/topics/sync-status/:courseId (issue #1217:
 * topics.js was the worst-covered route file, 14.3% statements — this router
 * was previously untested apart from indirect exercise via other suites).
 *
 * All DB (Prisma) and Core HTTP calls are mocked — no test DB required.
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

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: vi.fn() },
    topics: { findMany: vi.fn() },
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseTopicsFromCore: vi.fn(),
  getCourseEnrollmentsFromCore: vi.fn(),
  getCourseFromCore: vi.fn(),
  getMyProfileFromCore: vi.fn(),
}));

const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/database.js');
const {
  getCourseTopicsFromCore,
  getCourseEnrollmentsFromCore,
} = await import('../../src/services/coreApiService.js');

const INSTRUCTOR = { id: 'user-cuid-inst', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };
const STUDENT = { id: 'user-cuid-student', email: 'student@test.com', role: 'STUDENT', name: 'Student' };
// ADMIN short-circuits resolveAccessForCourse before the coreCourseId check
// (#1114), the only caller that can reach a course unlinked from Core.
const ADMIN = { id: 'user-cuid-admin', email: 'admin@test.com', role: 'ADMIN', name: 'Admin' };

function sessionOk(user) {
  return { ok: true, json: () => Promise.resolve({ user }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('GET /api/topics/sync-status/:courseId', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const res = await request(app).get('/api/topics/sync-status/1');

    expect(res.status).toBe(401);
  });

  it('returns 404 when the course does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(INSTRUCTOR)));
    prisma.course.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/topics/sync-status/999')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 when the caller lacks TA access on the course', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(STUDENT)));
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });
    getCourseEnrollmentsFromCore.mockResolvedValue({ enrollments: [] });

    const res = await request(app)
      .get('/api/topics/sync-status/1')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(403);
  });

  it('reports in-sync when all local topics are linked and counts match (data.topics shape)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(INSTRUCTOR)));
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });
    prisma.topics.findMany.mockResolvedValue([
      { id: 't1', courseId: 1, coreTopicId: 'core-t-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 't2', courseId: 1, coreTopicId: 'core-t-2', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [{ studentId: INSTRUCTOR.id, isActive: true, role: 'INSTRUCTOR' }],
    });
    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'core-t-1', name: 'A' }, { id: 'core-t-2', name: 'B' }],
    });

    const res = await request(app)
      .get('/api/topics/sync-status/1')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      inSync: true,
      localCount: 2,
      coreCount: 2,
      lastSyncedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('reports out-of-sync when some local topics are unlinked (data as bare array shape)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(INSTRUCTOR)));
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });
    prisma.topics.findMany.mockResolvedValue([
      { id: 't1', courseId: 1, coreTopicId: 'core-t-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 't2', courseId: 1, coreTopicId: null, updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [{ studentId: INSTRUCTOR.id, isActive: true, role: 'INSTRUCTOR' }],
    });
    // Bare-array Core response shape (not wrapped in { topics }).
    getCourseTopicsFromCore.mockResolvedValue([{ id: 'core-t-1', name: 'A' }]);

    const res = await request(app)
      .get('/api/topics/sync-status/1')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body.data.inSync).toBe(false);
    expect(res.body.data.localCount).toBe(2);
    expect(res.body.data.coreCount).toBe(1);
    expect(res.body.data.lastSyncedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports zero core topics and a null lastSyncedAt when the course has no local topics and is unlinked from Core', async () => {
    // Unlinked course: ADMIN is the only caller that can reach it (#1114).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(ADMIN)));
    prisma.course.findUnique.mockResolvedValue({
      id: 2,
      userId: INSTRUCTOR.id,
      coreCourseId: null,
    });
    prisma.topics.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/topics/sync-status/2')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      inSync: false,
      localCount: 0,
      coreCount: 0,
      lastSyncedAt: null,
    });
    expect(getCourseTopicsFromCore).not.toHaveBeenCalled();
  });

  it('treats an unrecognized Core response shape as zero core topics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk(INSTRUCTOR)));
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });
    prisma.topics.findMany.mockResolvedValue([
      { id: 't1', courseId: 1, coreTopicId: 'core-t-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [{ studentId: INSTRUCTOR.id, isActive: true, role: 'INSTRUCTOR' }],
    });
    getCourseTopicsFromCore.mockResolvedValue({ unexpected: 'shape' });

    const res = await request(app)
      .get('/api/topics/sync-status/1')
      .set('Cookie', 'session=valid');

    expect(res.status).toBe(200);
    expect(res.body.data.coreCount).toBe(0);
  });
});
