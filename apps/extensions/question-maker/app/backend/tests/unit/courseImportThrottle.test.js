/**
 * Unit tests for the GET /api/course auto-import mirror: throttled, fire-and-
 * forget, per-user (#1072 unified contract — mirrors ai-tutor's
 * `runCoreMirror`, apps/extensions/ai-tutor/server/src/routes/authentication.js).
 * No DB, no network — every collaborator of the route is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticateToken: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/courseAccess.js', () => ({
  requireCourseAccess: () => (_req, _res, next) => next(),
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock('../../src/schema/index.js', () => ({
  Course: { findAll: vi.fn() },
  Question_Metadata: {},
  Topics: {},
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  pushTopicToCore: vi.fn(),
  isCoreCourseInScopedList: vi.fn(),
  getCourseEnrollmentsFromCore: vi.fn(),
}));

vi.mock('../../src/services/courseListService.js', () => ({
  listCoursesForUser: vi.fn().mockResolvedValue([]),
  enrichCourseDetail: vi.fn(),
}));

vi.mock('../../src/services/topicSyncService.js', () => ({
  syncTopicsFromCoreForCourse: vi.fn(),
}));

vi.mock('../../src/services/importTaughtCoursesService.js', () => ({
  importTaughtCoursesFromCore: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { importTaughtCoursesFromCore } = await import(
  '../../src/services/importTaughtCoursesService.js'
);
const { listCoursesForUser } = await import('../../src/services/courseListService.js');
const courseModule = await import('../../src/routes/course.js');
const courseRouter = courseModule.default;
const { resetCoreImportThrottleForTests } = courseModule;

function appFor(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/course', courseRouter);
  return app;
}

const instructor = { id: 'u-1', role: 'INSTRUCTOR' };

describe('GET /api/course auto-import mirror throttle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCoreImportThrottleForTests();
    importTaughtCoursesFromCore.mockResolvedValue({ imported: 0, skipped: 0 });
    listCoursesForUser.mockResolvedValue([]);
  });

  it('triggers the Core mirror on the first list call', async () => {
    const res = await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');

    expect(res.status).toBe(200);
    expect(importTaughtCoursesFromCore).toHaveBeenCalledTimes(1);
    expect(importTaughtCoursesFromCore).toHaveBeenCalledWith('u-1', 'INSTRUCTOR', 'session=x');
  });

  it('does not re-trigger the mirror on a second list call within the throttle window', async () => {
    await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');
    const second = await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');

    expect(second.status).toBe(200);
    expect(importTaughtCoursesFromCore).toHaveBeenCalledTimes(1);
  });

  it('throttles per user, not globally', async () => {
    const other = { id: 'u-2', role: 'INSTRUCTOR' };

    await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');
    await request(appFor(other)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=y');

    expect(importTaughtCoursesFromCore).toHaveBeenCalledTimes(2);
  });

  it('does not block the list response on the mirror settling (fire-and-forget)', async () => {
    let releaseImport;
    importTaughtCoursesFromCore.mockImplementation(
      () => new Promise((resolve) => { releaseImport = resolve; }),
    );

    const res = await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');

    // The response already came back even though the mirror promise above is
    // still unsettled — proves the route didn't await it.
    expect(res.status).toBe(200);
    expect(releaseImport).toBeDefined();
    releaseImport({ imported: 0, skipped: 0 });
  });

  it('logs and swallows a mirror failure without failing the list response', async () => {
    importTaughtCoursesFromCore.mockRejectedValue(new Error('Core unreachable'));

    const res = await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');

    expect(res.status).toBe(200);
  });

  it('resetCoreImportThrottleForTests clears the per-user throttle', async () => {
    await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');
    resetCoreImportThrottleForTests();
    await request(appFor(instructor)).get('/api/course?page=1&pageSize=25').set('Cookie', 'session=x');

    expect(importTaughtCoursesFromCore).toHaveBeenCalledTimes(2);
  });
});
