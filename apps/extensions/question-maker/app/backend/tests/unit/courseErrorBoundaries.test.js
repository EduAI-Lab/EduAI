/**
 * Core failure responses for course routes must be stable and must not copy
 * upstream error text into HTTP responses or logs.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isCoreCourseInScopedList, syncTopicsFromCoreForCourse } = vi.hoisted(() => ({
  isCoreCourseInScopedList: vi.fn(),
  syncTopicsFromCoreForCourse: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticateToken: (req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/courseAccess.js', () => ({
  requireCourseAccess: () => (req, _res, next) => {
    req.qmCourse = { id: 7, userId: req.user.id, coreCourseId: 'core-course' };
    next();
  },
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    questionMetadata: {},
    topics: {},
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  pushTopicToCore: vi.fn(),
  isCoreCourseInScopedList,
  getCourseEnrollmentsFromCore: vi.fn(),
}));

vi.mock('../../src/services/courseListService.js', () => ({
  listCoursesPageForUser: vi.fn().mockResolvedValue({ courses: [], total: 0 }),
  enrichCourseDetail: vi.fn(),
}));

vi.mock('../../src/services/topicSyncService.js', () => ({
  syncTopicsFromCoreForCourse,
}));

vi.mock('../../src/services/importTaughtCoursesService.js', () => ({
  importTaughtCoursesFromCore: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const { default: courseRouter } = await import('../../src/routes/course.js');
const { logger } = await import('../../src/utils/logger.js');

function appFor(user = { id: 'u-1', role: 'INSTRUCTOR' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/course', courseRouter);
  return app;
}

function upstreamCanaryError() {
  return Object.assign(
    new Error('Core upstream https://core.example/api?api_key=core-secret-canary'),
    { status: 502, code: 'ECONNRESET' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isCoreCourseInScopedList.mockResolvedValue(true);
  syncTopicsFromCoreForCourse.mockResolvedValue(1);
});

describe('course route Core error boundaries', () => {
  it('returns a stable error for POST /api/course scoped-list failures', async () => {
    isCoreCourseInScopedList.mockRejectedValueOnce(upstreamCanaryError());

    const response = await request(appFor())
      .post('/api/course')
      .set('Cookie', 'session=valid')
      .send({ coreCourseId: 'core-course' });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ success: false, error: 'Core API error (502)' });
    expect(JSON.stringify(response.body)).not.toContain('core-secret-canary');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('core-secret-canary');
  });

  it('returns a stable error for PATCH /api/course/:id/link-core failures', async () => {
    isCoreCourseInScopedList.mockRejectedValueOnce(upstreamCanaryError());

    const response = await request(appFor())
      .patch('/api/course/7/link-core')
      .set('Cookie', 'session=valid')
      .send({ coreCourseId: 'core-course' });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ success: false, error: 'Core API error (502)' });
    expect(JSON.stringify(response.body)).not.toContain('core-secret-canary');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('core-secret-canary');
  });

  it('rejects a different Core target before scoped lookup or persistence', async () => {
    const response = await request(appFor())
      .patch('/api/course/7/link-core')
      .set('Cookie', 'session=valid')
      .send({ coreCourseId: 'core-course-2' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CORE_COURSE_LINK_IMMUTABLE',
    });
    expect(isCoreCourseInScopedList).not.toHaveBeenCalled();
    const { prisma } = await import('../../src/config/database.js');
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('returns a stable error for POST /api/course/:id/sync-topics failures', async () => {
    syncTopicsFromCoreForCourse.mockRejectedValueOnce(upstreamCanaryError());

    const response = await request(appFor())
      .post('/api/course/7/sync-topics')
      .set('Cookie', 'session=valid');

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ success: false, error: 'Core API error (502)' });
    expect(JSON.stringify(response.body)).not.toContain('core-secret-canary');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('core-secret-canary');
  });
});
