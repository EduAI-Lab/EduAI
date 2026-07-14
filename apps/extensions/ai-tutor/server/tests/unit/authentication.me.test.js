/**
 * Unit tests for GET /api/me effective-role resolution (AI Tutor server).
 *
 * Core dropped the platform-level UserRole.TA (#664): a course TA is a
 * STUDENT-platform user with Enrollment(role=TA). `/api/me` surfaces an
 * effective TA role so the client RBAC (which keys its view off a single role
 * string) still routes course TAs into the teaching shell after the migration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourses: vi.fn(),
}));

vi.mock('../../src/services/importTaughtCoursesService.js', () => ({
  importTaughtCoursesFromCore: vi.fn().mockResolvedValue({}),
  importEnrolledCoursesFromCore: vi.fn().mockResolvedValue({}),
  userHasCoreTaEnrollment: vi.fn(),
}));

const { listEduAiCourses } = await import('../../src/services/eduaiClient.js');
const {
  importTaughtCoursesFromCore,
  importEnrolledCoursesFromCore,
  userHasCoreTaEnrollment,
} = await import('../../src/services/importTaughtCoursesService.js');
const authModule = await import('../../src/routes/authentication.js');
const authRouter = authModule.default;
const { resetCoreMirrorThrottleForTests } = authModule;

function appFor(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api', authRouter);
  return app;
}

const student = { id: 'u-1', name: 'Sam', email: 'sam@test.com', role: 'STUDENT' };
const coreCourses = [
  { id: 'core-1', callerEnrollmentRole: 'STUDENT' },
  { id: 'core-2', callerEnrollmentRole: 'TA' },
];

describe('GET /api/me effective TA role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The course mirror is throttled per-user across calls; reset so each test
    // starts unthrottled and its import-call assertions hold.
    resetCoreMirrorThrottleForTests();
    listEduAiCourses.mockResolvedValue(coreCourses);
  });

  it('fetches Core courses once and passes the list to import + TA resolution', async () => {
    userHasCoreTaEnrollment.mockResolvedValue(true);

    const res = await request(appFor(student)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('TA');
    expect(listEduAiCourses).toHaveBeenCalledOnce();
    expect(importTaughtCoursesFromCore).toHaveBeenCalledWith(
      student,
      '',
      { coreCourses },
    );
    expect(importEnrolledCoursesFromCore).toHaveBeenCalledWith(
      student,
      '',
      { coreCourses },
    );
    expect(userHasCoreTaEnrollment).toHaveBeenCalledWith('', coreCourses);
  });

  it('keeps role STUDENT when Core reports no TA enrollment', async () => {
    userHasCoreTaEnrollment.mockResolvedValue(false);

    const res = await request(appFor(student)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('STUDENT');
  });

  it('falls back to the platform role when the TA check throws', async () => {
    userHasCoreTaEnrollment.mockRejectedValue(new Error('Core unavailable'));

    const res = await request(appFor(student)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('STUDENT');
  });

  it('skips TA resolution when the Core course list fetch fails', async () => {
    listEduAiCourses.mockRejectedValue(new Error('Core unavailable'));

    const res = await request(appFor(student)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('STUDENT');
    expect(userHasCoreTaEnrollment).not.toHaveBeenCalled();
    expect(importTaughtCoursesFromCore).toHaveBeenCalledWith(student, '', {});
    expect(importEnrolledCoursesFromCore).toHaveBeenCalledWith(student, '', {});
  });

  it('does not run the TA check for non-STUDENT platform roles', async () => {
    const instructor = { ...student, role: 'INSTRUCTOR' };

    const res = await request(appFor(instructor)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('INSTRUCTOR');
    expect(userHasCoreTaEnrollment).not.toHaveBeenCalled();
  });
});
