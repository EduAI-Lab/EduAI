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
    syncExternalCourseTopics: vi.fn(),
    syncCourseEnrollments: vi.fn(),
  };
});

import { findEduAiCourseById, listEduAiCourses } from '../../src/services/eduaiClient.js';
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
    vi.mocked(syncExternalCourseTopics).mockClear();
    vi.mocked(syncCourseEnrollments).mockClear();
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
      const res = await request(profApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.course.id);
      expect(res.body[0].title).toBe('Test Course');
      // Professor courses have no progress object
      expect(res.body[0].progress).toBeUndefined();
    });

    it('student sees published+enrolled courses with progress object', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.course.id);
      expect(res.body[0].progress).toEqual(
        expect.objectContaining({
          completed: expect.any(Number),
          total: expect.any(Number),
          percentage: expect.any(Number),
        }),
      );
    });

    it('TA sees TA-enrolled course (no progress, all publish states)', async () => {
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { isPublished: false },
      });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.course.id);
      expect(res.body[0].progress).toBeUndefined();
    });

    it('TA sees zero courses when not enrolled in any', async () => {
      const ta = makeTA();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('ADMIN sees every course offering, including ones they do not own (#781)', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body.map((c) => c.id)).toContain(seed.course.id);
    });

    it('ADMIN sees Core courses with no local anchor yet — create-on-open (#1072 step 3 / #1074)', async () => {
      const UNANCHORED_CORE_ID = 'core-cuid-unanchored';
      vi.mocked(listEduAiCourses).mockResolvedValue([
        { id: UNANCHORED_CORE_ID, code: 'COSC 999', name: 'Not Yet Imported', callerEnrollmentRole: 'ADMIN' },
      ]);
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const before = await prisma.courseOffering.findFirst({
        where: { coreOfferingId: UNANCHORED_CORE_ID },
      });
      expect(before).toBeNull();

      const res = await request(adminApp).get('/api/courses');

      expect(res.status).toBe(200);
      expect(res.body.map((c) => c.coreOfferingId)).toContain(UNANCHORED_CORE_ID);

      // The anchor was materialized as a side effect of the list request.
      const after = await prisma.courseOffering.findFirst({
        where: { coreOfferingId: UNANCHORED_CORE_ID },
      });
      expect(after).not.toBeNull();
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
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { isPublished: false },
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
    it('publishes a course', async () => {
      // Unpublish it first so we can test publishing
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { isPublished: false },
      });

      const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(true);
    });
  });

  // ── PATCH /api/courses/:id/unpublish ──────────────────────────────

  describe('PATCH /api/courses/:id/unpublish', () => {
    it('unpublishes a course and cascades to modules and lessons', async () => {
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

    it('returns 400 for a native course without a coreOfferingId', async () => {
      const res = await request(profApp)
        .post(`/api/courses/${seed.course.id}/sync-enrollments`)
        .set('Cookie', 'session=valid');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not imported from EduAI/i);
    });
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
      data: { coreOfferingId: CORE_OFFERING_ID, isPublished: false },
    });

    // setCoreCoursePublishState and listEduAiCourses check for this key before calling fetch.
    process.env.EDUAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EDUAI_API_KEY;
  });

  it('publish — calls Core publish endpoint and updates local isPublished', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(true);

    // Verify Core was called with the right URL and method.
    const coreCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(`/courses/${CORE_OFFERING_ID}/publish`),
    );
    expect(coreCalls).toHaveLength(1);
    expect(coreCalls[0][1].method).toBe('PATCH');

    // Verify local DB was also updated.
    const updated = await prisma.courseOffering.findUnique({ where: { id: seed.course.id } });
    expect(updated.isPublished).toBe(true);
  });

  it('unpublish — calls Core unpublish endpoint and cascades locally', async () => {
    // Seed as published first.
    await prisma.courseOffering.update({ where: { id: seed.course.id }, data: { isPublished: true } });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: false }),
    });
    vi.stubGlobal('fetch', mockFetch);

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

    // Local state must remain unchanged.
    const unchanged = await prisma.courseOffering.findUnique({ where: { id: seed.course.id } });
    expect(unchanged.isPublished).toBe(false);
  });

  it('publish — no Core call when coreOfferingId is null (native course)', async () => {
    // Remove the Core link — native course.
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: null, isPublished: false },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

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
