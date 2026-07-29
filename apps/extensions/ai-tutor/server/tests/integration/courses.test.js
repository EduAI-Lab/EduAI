import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeStudent,
  makeAdmin,
  makeTA,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findEduAiCourseById: vi.fn(),
    listEduAiCourses: vi.fn(),
    listEduAiCoursesServiceKey: vi.fn(),
    fetchCoreCourseSafe: vi.fn(),
    syncExternalCourseTopics: vi.fn(),
    syncCourseEnrollments: vi.fn(),
  };
});

import {
  fetchCoreCourseSafe,
  findEduAiCourseById,
  listEduAiCourses,
  listEduAiCoursesServiceKey,
} from '../../src/services/eduaiClient.js';
import { syncExternalCourseTopics } from '../../src/services/topicSync.js';
import { syncCourseEnrollments } from '../../src/services/enrollmentSync.js';

// Course routes call Core's policy service (instructors.canCreateCourses) via
// requireInstructorPolicy. Core isn't reachable in the integration env, so the
// real service fails closed (deny). Stub it to the flag's enabled default —
// the deny/cache/stale-fallback behaviour is covered by policyService.test.js.
vi.mock('../../src/services/policyService.js', () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  getPolicies: vi.fn().mockResolvedValue({ 'instructors.canCreateCourses': true }),
  invalidatePolicyCache: vi.fn(),
  __resetPolicyServiceState: vi.fn(),
}));

vi.mock('../../src/services/topicSync.js', () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/enrollmentSync.js', () => ({
  syncCourseEnrollments: vi.fn().mockResolvedValue({ synced: 2, created: 1, deleted: 0, errors: [] }),
}));

describe('Courses routes', () => {
  let prof;
  let seed; // { user, course, module, lesson, topic }
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });
    vi.mocked(findEduAiCourseById).mockReset();
    vi.mocked(listEduAiCourses).mockReset();
    vi.mocked(listEduAiCoursesServiceKey).mockReset();
    vi.mocked(syncExternalCourseTopics).mockClear();
    vi.mocked(syncCourseEnrollments).mockClear();

    // Course-owned fields (title/isPublished/etc) are Core-owned (#1072 step
    // 2/4) — default the seeded course to a resolved, published Core course
    // so pre-#1072 expectations ("Test Course", published) still hold;
    // individual tests override list/detail mocks as needed.
    // `callerEnrollmentRole: 'NONE'` is a deliberate non-match sentinel: it
    // fails every role check in importTaughtCoursesService.js
    // (isTeachingCoreCourse/isStudentCoreCourse/isTaCoreCourse all require an
    // exact 'INSTRUCTOR'/'STUDENT'/'TA' string — `undefined` would otherwise
    // default-match `isStudentCoreCourse`), so this default never triggers
    // the auto-import/auto-enrollment side effects on `GET /courses` that
    // would otherwise leak enrollments across tests in this file.
    const defaultCoreCourse = {
      id: seed.course.coreOfferingId,
      name: 'Test Course',
      isPublished: true,
      callerEnrollmentRole: 'NONE',
    };
    // Unified contract (#1072): the service-key catalog is the field/publish
    // source for list routes; the cookie-scoped list only feeds the
    // auto-import mirrors (callerEnrollmentRole). Default both to the same
    // course so either consumer resolves it.
    vi.mocked(listEduAiCourses).mockResolvedValue([defaultCoreCourse]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([defaultCoreCourse]);
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue(defaultCoreCourse);
  });

  // ── Helper to create and enroll a student ─────────────────────────

  async function enrollStudent() {
    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: {
        courseOfferingId: seed.course.id,
        userId: student.id,
        role: 'STUDENT',
      },
    });
    return student;
  }

  async function enrollTa() {
    const ta = makeTA();
    await prisma.courseEnrollment.create({
      data: {
        courseOfferingId: seed.course.id,
        userId: ta.id,
        role: 'TA',
      },
    });
    return ta;
  }

  // ── GET /api/courses ──────────────────────────────────────────────

  describe('GET /api/courses', () => {
    it('professor sees their courses', async () => {
      const res = await request(profApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(seed.course.id);
      expect(res.body.data[0].title).toBe('Test Course');
      // Professor courses have no progress object
      expect(res.body.data[0].progress).toBeUndefined();
    });

    it('student sees published+enrolled courses with progress object', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(seed.course.id);
      expect(res.body.data[0].progress).toEqual(
        expect.objectContaining({
          completed: expect.any(Number),
          total: expect.any(Number),
          percentage: expect.any(Number),
        }),
      );
    });

    it('TA sees TA-enrolled course (no progress, all publish states)', async () => {
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: false },
      ]);
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(seed.course.id);
      expect(res.body.data[0].progress).toBeUndefined();
    });

    it('TA sees zero courses when not enrolled in any', async () => {
      const ta = makeTA();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('ADMIN sees every course offering, including ones they do not own (#781)', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.id)).toContain(seed.course.id);
    });

    // #1082: AT and Core enrollment are independent tracks. A STUDENT/TA can
    // be enrolled in the local AT course (`enrollStudent`/`enrollTa` below)
    // without a matching Core enrollment, so Core's cookie-scoped list
    // (`listEduAiCourses`) silently omits the course — reproduces the raw-HTTP
    // repro that motivated this fix.
    it('STUDENT sees an AT-enrolled course via the service-key fallback when not Core-enrolled (#1082)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]); // not in the caller's Core-scoped list
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: true },
      ]);
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(seed.course.id);
      expect(res.body.data[0].title).toBe('Test Course');
      expect(res.body.data[0].isPublished).toBe(true);
      expect(listEduAiCoursesServiceKey).toHaveBeenCalledTimes(1);
    });

    it('STUDENT still sees no courses when the AT-enrolled course is unpublished in Core, even via the fallback (#1082 fail-closed)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]);
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: false },
      ]);
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('STUDENT sees no courses when the fallback catalog also has no match (both-miss stays hidden)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]);
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([]);
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('TA sees an AT-enrolled course via the service-key fallback when not Core-enrolled (#1082)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]);
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: false },
      ]);
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(seed.course.id);
      expect(res.body.data[0].title).toBe('Test Course');
    });

    it('ADMIN sees Core courses with no local anchor yet — create-on-open (#1072 step 3 / #1074)', async () => {
      const UNANCHORED_CORE_ID = 'core-cuid-unanchored';
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: UNANCHORED_CORE_ID, code: 'COSC 999', name: 'Not Yet Imported' },
      ]);
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const before = await prisma.courseOffering.findFirst({
        where: { coreOfferingId: UNANCHORED_CORE_ID },
      });
      expect(before).toBeNull();

      const res = await request(adminApp).get('/api/courses?page=1&pageSize=200');

      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.coreOfferingId)).toContain(UNANCHORED_CORE_ID);

      // The anchor was materialized as a side effect of the list request.
      const after = await prisma.courseOffering.findFirst({
        where: { coreOfferingId: UNANCHORED_CORE_ID },
      });
      expect(after).not.toBeNull();
    });

    it('returns 400 PAGINATION_REQUIRED when page/pageSize are omitted', async () => {
      const res = await request(profApp).get('/api/courses');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAGINATION_REQUIRED');
    });
  });

  // ── GET /api/courses/:id ──────────────────────────────────────────

  describe('GET /api/courses/:id', () => {
    it('returns course details for a member', async () => {
      const res = await request(profApp).get(`/api/courses/${seed.course.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(seed.course.id);
      expect(res.body.title).toBe('Test Course');
      expect(res.body.isPublished).toBe(true);
    });

    it('TA enrolled in course can access course details', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/courses/${seed.course.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(seed.course.id);
    });

    it('TA enrolled in course sees it even when unpublished', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({
        id: seed.course.coreOfferingId,
        name: 'Test Course',
        isPublished: false,
      });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/courses/${seed.course.id}`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);
    });

    it('returns 403 for non-member', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).get(`/api/courses/${seed.course.id}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent course', async () => {
      const res = await request(profApp).get('/api/courses/999999');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/courses ─────────────────────────────────────────────

  describe('POST /api/courses', () => {
    it('returns 403 — course creation is managed in EduAI Core (#632)', async () => {
      const res = await request(profApp)
        .post('/api/courses')
        .send({ title: 'New Course', description: 'A brand new course' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/EduAI Core/i);
    });
  });

  // ── PATCH /api/courses/:id/publish ────────────────────────────────

  describe('PATCH /api/courses/:id/publish', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('publishes a course', async () => {
      // Every course is Core-linked now (#1072 step 4) — publish writes
      // through to Core over the real `fetch`, so it must be stubbed.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
          json: () => Promise.resolve({ id: seed.course.coreOfferingId, isPublished: true }),
        }),
      );

      const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(true);
    });
  });

  // ── PATCH /api/courses/:id/unpublish ──────────────────────────────

  describe('PATCH /api/courses/:id/unpublish', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('unpublishes a course and cascades to modules and lessons', async () => {
      // Every course is Core-linked now (#1072 step 4) — unpublish writes
      // through to Core over the real `fetch`, so it must be stubbed. The
      // read-back after unpublish goes through the module-mocked
      // `fetchCoreCourseSafe` (shared across this file), not the raw `fetch`
      // stub, so it needs its own override.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
          json: () => Promise.resolve({ id: seed.course.coreOfferingId, isPublished: false }),
        }),
      );
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({
        id: seed.course.coreOfferingId,
        isPublished: false,
      });

      const res = await request(profApp).patch(`/api/courses/${seed.course.id}/unpublish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);

      // Verify module was unpublished
      const updatedModule = await prisma.module.findUnique({
        where: { id: seed.module.id },
      });
      expect(updatedModule.isPublished).toBe(false);

      // Verify lesson was unpublished
      const updatedLesson = await prisma.lesson.findUnique({
        where: { id: seed.lesson.id },
      });
      expect(updatedLesson.isPublished).toBe(false);
    });
  });

  // ── POST /api/courses/import-external (#578) ─────────────────────

  describe('POST /api/courses/import-external', () => {
    it('imports a Core course the instructor is enrolled in', async () => {
      vi.mocked(findEduAiCourseById).mockResolvedValue({
        id: 'core-course-1',
        code: 'COSC 111',
        name: 'Computing I',
        term: 'Fall',
        year: 2026,
      });

      const res = await request(profApp)
        .post('/api/courses/import-external')
        .set('Cookie', 'session=valid')
        .send({ externalCourseId: 'core-course-1' });

      expect(res.status).toBe(201);
      expect(res.body.coreOfferingId).toBe('core-course-1');
      expect(findEduAiCourseById).toHaveBeenCalledWith(
        'core-course-1',
        expect.objectContaining({ cookie: 'session=valid' }),
      );
    });

    it('is an idempotent ensure: re-importing an already-anchored course returns 200 with the same offering', async () => {
      vi.mocked(findEduAiCourseById).mockResolvedValue({
        id: 'core-course-1',
        code: 'COSC 111',
        name: 'Computing I',
        term: 'W1',
        year: 2026,
      });

      const first = await request(profApp)
        .post('/api/courses/import-external')
        .set('Cookie', 'session=valid')
        .send({ externalCourseId: 'core-course-1' });
      expect(first.status).toBe(201);

      // Second import (e.g. the caller raced the background mirror, or simply
      // retried) succeeds with the existing row rather than conflicting.
      const second = await request(profApp)
        .post('/api/courses/import-external')
        .set('Cookie', 'session=valid')
        .send({ externalCourseId: 'core-course-1' });
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.coreOfferingId).toBe('core-course-1');
    });

    it('returns 403 when the Core course is not in the instructor scoped list (#578)', async () => {
      vi.mocked(findEduAiCourseById).mockResolvedValue(null);

      const res = await request(profApp)
        .post('/api/courses/import-external')
        .set('Cookie', 'session=valid')
        .send({ externalCourseId: 'core-course-not-mine' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
    });

    it('returns 400 without externalCourseId', async () => {
      const res = await request(profApp)
        .post('/api/courses/import-external')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/courses/:courseId/sync-enrollments (#578)', () => {
    it('syncs student enrollments for an EduAI-imported course the instructor owns', async () => {
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { coreOfferingId: 'core-1' },
      });

      const res = await request(profApp)
        .post(`/api/courses/${seed.course.id}/sync-enrollments`)
        .set('Cookie', 'session=valid');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 2, created: 1, deleted: 0, errors: [] });
      expect(syncCourseEnrollments).toHaveBeenCalledWith(
        seed.course.id,
        expect.objectContaining({ course: expect.objectContaining({ id: seed.course.id }) }),
      );
    });

    it('returns 403 when the instructor is not assigned to the course', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp)
        .post(`/api/courses/${seed.course.id}/sync-enrollments`)
        .set('Cookie', 'session=valid');

      expect(res.status).toBe(403);
    });

    // The "native course, no coreOfferingId" scenario this test covered is no
    // longer constructible: #1072 step 4 made `coreOfferingId` required at the
    // DB level, so every CourseOffering row is Core-linked by construction.
    // The route's `!course.coreOfferingId` guard is dead code now, harmlessly
    // so; left in place rather than removed as part of this migration.
  });

  // ── GET /api/courses/:courseId/submissions (enriched) ─────────────

  describe('GET /api/courses/:courseId/submissions', () => {
    let activity;

    beforeEach(async () => {
      activity = await prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
          instructionsMd: 'Answer.',
          config: {
            question: 'What is 2+2?',
            questionType: 'MCQ',
            options: ['3', '4', '5'],
            answer: 1,
            hints: [],
          },
        },
      });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });
    });

    it('enriches rows with lesson/question context and a human answer label', async () => {
      const res = await request(profApp).get(`/api/courses/${seed.course.id}/submissions`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      const row = res.body[0];
      expect(row.lessonTitle).toBe('Test Lesson');
      expect(row.questionText).toBe('What is 2+2?');
      // answerOption 1 → options[1] === '4' (index mapped back to the label)
      expect(row.answerLabel).toBe('4');
      // No Core service key wired in the test env → studentName degrades to null.
      expect(row).toHaveProperty('studentName');
    });

    it('enrolled TA can read submissions', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(200);
    });

    it('STUDENT gets 403', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      const res = await request(studentApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(403);
    });

    it('400 when take is not a number', async () => {
      const res = await request(profApp).get(
        `/api/courses/${seed.course.id}/submissions?take=lots`,
      );
      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/me/dashboard-stats (role-aware rollup) ───────────────

  describe('GET /api/me/dashboard-stats', () => {
    it('INSTRUCTOR gets their course rollup', async () => {
      const res = await request(profApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('INSTRUCTOR');
      expect(res.body.yourCourses).toBe(1);
      expect(res.body.publishedCourses).toBe(1);
      expect(res.body).toHaveProperty('submissionsToReview');
    });

    it('STUDENT gets an enrolled/progress rollup', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      const res = await request(studentApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('STUDENT');
      expect(res.body.enrolledCourses).toBe(1);
      expect(res.body).toHaveProperty('correctAnswerPercentage');
    });

    it('TA gets a TA rollup', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('TA');
      expect(res.body.yourCourses).toBe(1);
    });

    it('ADMIN gets a platform rollup', async () => {
      const adminApp = await createApp({ mockUser: makeAdmin() });
      const res = await request(adminApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.totalCourses).toBe(1);
      expect(res.body.publishedCourses).toBe(1);
    });

    // #1082: dashboard-stats counterpart of the GET /courses fallback tests
    // above — the publish count must read through the same service-key
    // fallback, not just the caller-facing list.
    it('STUDENT rollup counts an AT-enrolled course via the service-key fallback when not Core-enrolled (#1082)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]);
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: true },
      ]);
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('STUDENT');
      expect(res.body.enrolledCourses).toBe(1);
    });

    it('TA rollup counts an AT-enrolled course via the service-key fallback when not Core-enrolled (#1082)', async () => {
      vi.mocked(listEduAiCourses).mockResolvedValue([]);
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Test Course', isPublished: true },
      ]);
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/me/dashboard-stats');

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('TA');
      expect(res.body.yourCourses).toBe(1);
      expect(res.body.publishedCourses).toBe(1);
    });
  });
});

// ── Core write-through: publish state propagation (#477) ──────────────────────

describe('Course publish state — Core write-through (#477)', () => {
  let prof;
  let seed;
  let profApp;
  const CORE_OFFERING_ID = 'core-cuid-abc123';

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });

    // Link the seeded course to a Core offering so write-through is triggered.
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: CORE_OFFERING_ID },
    });

    // setCoreCoursePublishState and listEduAiCourses check for this key before calling fetch.
    process.env.EDUAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EDUAI_API_KEY;
  });

  it('publish — calls Core publish endpoint and reads isPublished back from Core', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: true }),
    });
    vi.stubGlobal('fetch', mockFetch);
    // `fetchCoreCourseSafe` is module-mocked (shared across this file's
    // describe blocks) — it no longer goes through the raw `fetch` stub
    // above, so the read-back after publish must be set explicitly too.
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ id: CORE_OFFERING_ID, isPublished: true });

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(true);

    // Verify Core was called with the right URL and method.
    const coreCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(`/courses/${CORE_OFFERING_ID}/publish`),
    );
    expect(coreCalls).toHaveLength(1);
    expect(coreCalls[0][1].method).toBe('PATCH');

    // No local `isPublished` column exists anymore (#1072 step 4) — Core is
    // the sole store; the response body above is the only place to check.
  });

  it('unpublish — calls Core unpublish endpoint and cascades locally', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: false }),
    });
    vi.stubGlobal('fetch', mockFetch);
    // `fetchCoreCourseSafe` is module-mocked (shared across this file's
    // describe blocks) — it no longer goes through the raw `fetch` stub
    // above, so the read-back after unpublish must be set explicitly too.
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ id: CORE_OFFERING_ID, isPublished: false });

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/unpublish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(false);

    const coreCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(`/courses/${CORE_OFFERING_ID}/unpublish`),
    );
    expect(coreCalls).toHaveLength(1);

    // Cascade: module and lesson should also be unpublished.
    const updatedModule = await prisma.module.findUnique({ where: { id: seed.module.id } });
    const updatedLesson = await prisma.lesson.findUnique({ where: { id: seed.lesson.id } });
    expect(updatedModule.isPublished).toBe(false);
    expect(updatedLesson.isPublished).toBe(false);
  });

  it('publish — surfaces Core errors as 500 without touching local DB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }));

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(500);
    // No local `isPublished` column exists anymore (#1072 step 4) — there is
    // nothing local left to leave "untouched"; the write-through call
    // erroring and short-circuiting before the response is the guarantee.
  });

  // The "publish — no Core call when coreOfferingId is null (native course)"
  // scenario this used to cover is no longer constructible: #1072 step 4 made
  // `coreOfferingId` required + unique, so every CourseOffering row is
  // Core-linked by construction. The route's `if (course.coreOfferingId)`
  // guard is dead code now, harmlessly so; left in place rather than removed
  // as part of this migration.

  it('import — sets coreOfferingId; isPublished is read-through from the Core course, not stored locally (#1072 step 3)', async () => {
    const EXTERNAL_COURSE_ID = 'core-cuid-xyz';
    const coreCourse = {
      id: EXTERNAL_COURSE_ID,
      code: 'COSC 999',
      name: 'Published Course',
      isPublished: true,
    };

    vi.mocked(findEduAiCourseById).mockResolvedValue(coreCourse);

    const res = await request(profApp)
      .post('/api/courses/import-external')
      .set('Cookie', 'session=valid')
      .send({ externalCourseId: EXTERNAL_COURSE_ID });

    expect(res.status).toBe(201);
    expect(res.body.coreOfferingId).toBe(EXTERNAL_COURSE_ID);
    expect(res.body.isPublished).toBe(true);
    expect(findEduAiCourseById).toHaveBeenCalledWith(
      EXTERNAL_COURSE_ID,
      expect.objectContaining({ cookie: 'session=valid' }),
    );

    const imported = await prisma.courseOffering.findFirst({
      where: { coreOfferingId: EXTERNAL_COURSE_ID },
    });
    expect(imported).not.toBeNull();
  });
});
