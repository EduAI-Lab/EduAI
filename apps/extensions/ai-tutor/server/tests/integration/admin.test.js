import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, makeStudent, makeTA, makeUnitAdmin, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
  listEduAiCourses: vi.fn(),
  // Unified contract (#1072): fields/department come from the service-key
  // catalog — the admin course list and ai-traces routes read this one.
  listEduAiCoursesServiceKey: vi.fn(),
  findEduAiCourseById: vi.fn(),
  listEduAiCourseTopics: vi.fn(),
  listEduAiModels: vi.fn(),
  getEduAiBaseUrl: vi.fn(() => 'http://localhost:5174/api'),
  getEduAiChatUrl: vi.fn(() => 'http://localhost:5174/api/chat'),
  postCoreBugReport: vi.fn(),
  listCoreAdminUsers: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
  listCourseTestableQuestions: vi.fn(),
  patchCoreEnrollmentRole: vi.fn(),
  deleteCoreEnrollment: vi.fn(),
  // `department` is Core-owned (#1072 step 4) — `isCourseAdmin`'s
  // self-resolve path and the ai-traces route both resolve it live via
  // these two, so UNIT_ADMIN-scoped tests below stub them per course.
  fetchCoreCourseSafe: vi.fn(),
}));

import {
  deleteCoreEnrollment,
  fetchCoreCourseSafe,
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  listEduAiCourses,
  listEduAiCoursesServiceKey,
  patchCoreEnrollmentRole,
} from '../../src/services/eduaiClient.js';

/**
 * #1041: `listCoreAdminUsers` answers with Core's `{ data, total, page, pageSize }`
 * envelope, and the enrollment route makes two calls per request — an `?ids=`
 * lookup for enrolled users plus a role-scoped page for the picker. Stub both
 * from one row set, honouring `ids` when it is passed.
 */
function stubCoreUsers(rows) {
  listCoreAdminUsers.mockImplementation(async (_cookie, options = {}) => {
    const data = rows
      .filter((r) => (options.ids ? options.ids.includes(r.id) : true))
      // Core applies `?role=` server-side now, so the stub must too.
      .filter((r) => (options.role ? r.role === options.role : true));
    return { data, total: data.length, page: 1, pageSize: data.length || 25 };
  });
}

describe('Admin routes', () => {
  let admin;
  let adminApp;

  beforeEach(async () => {
    await truncateAll();
    // stubCoreUsers() installs a persistent implementation — reset it per test
    // so a stub never leaks into a case that expects an empty Core response.
    stubCoreUsers([]);
    admin = makeAdmin();
    adminApp = await createApp({ mockUser: admin });
  });

  // ── GET /api/admin/users ──────────────────────────────────────────
  // User identity lives in Core; AI Tutor proxies GET /api/users with the admin cookie.

  describe('GET /api/admin/users', () => {
    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp).get('/api/admin/users');
      expect(res.status).toBe(403);
    });

    it('returns users proxied from Core', async () => {
      stubCoreUsers([
        {
          id: 'user-1',
          name: 'EduAI Admin',
          email: 'admin@eduai.local',
          role: 'ADMIN',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        {
          id: 'user-2',
          name: 'Student One',
          email: 'student1@eduai.local',
          role: 'STUDENT',
          createdAt: '2026-06-02T12:00:00.000Z',
        },
      ]);

      const res = await request(adminApp).get('/api/admin/users');

      expect(res.status).toBe(200);
      expect(listCoreAdminUsers).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ page: 1, pageSize: 25 }),
      );
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.data[0]).toMatchObject({
        name: 'EduAI Admin',
        email: 'admin@eduai.local',
        role: 'ADMIN',
      });
    });
  });

  // ── GET /api/admin/courses ────────────────────────────────────────

  describe('GET /api/admin/courses', () => {
    it('returns course list for admin', async () => {
      await import('../helpers.js').then(({ prisma }) =>
        prisma.courseOffering.create({
          data: { coreOfferingId: 'core-admin-test-course' },
        }),
      );

      const res = await request(adminApp).get('/api/admin/courses');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('title');
      expect(res.body[0]).toHaveProperty('isPublished');
    });

    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp).get('/api/admin/courses');
      expect(res.status).toBe(403);
    });

    it('materializes an anchor for a Core course with no local row yet — create-on-open (#1072 step 3 / #1074)', async () => {
      const UNANCHORED_CORE_ID = 'core-cuid-admin-unanchored';
      vi.mocked(listEduAiCoursesServiceKey).mockResolvedValueOnce([
        { id: UNANCHORED_CORE_ID, code: 'MATH 200', name: 'Not Yet Imported' },
      ]);

      const res = await request(adminApp).get('/api/admin/courses');

      expect(res.status).toBe(200);
      expect(res.body.map((c) => c.coreOfferingId)).toContain(UNANCHORED_CORE_ID);

      const anchor = await prisma.courseOffering.findFirst({
        where: { coreOfferingId: UNANCHORED_CORE_ID },
      });
      expect(anchor).not.toBeNull();
    });
  });

  // ── PATCH /api/admin/users/:id/role ───────────────────────────────

  describe('PATCH /api/admin/users/:userId/role', () => {
    it('returns 410 (roles managed by EduAI)', async () => {
      const res = await request(adminApp)
        .patch(`/api/admin/users/${admin.id}/role`)
        .send({ role: 'INSTRUCTOR' });

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/EduAI/i);
    });
  });

  // ── GET /api/admin/settings/eduai-api-key ─────────────────────────

  describe('GET /api/admin/settings/eduai-api-key', () => {
    it('returns API key status', async () => {
      const res = await request(adminApp).get('/api/admin/settings/eduai-api-key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured');
      expect(res.body).toHaveProperty('source');
      expect(res.body).toHaveProperty('hasAdminOverride');
      expect(res.body).toHaveProperty('envConfigured');
    });
  });

  // ── POST /api/admin/courses/:courseId/sync-enrollments ────────────

  describe('POST /api/admin/courses/:courseId/sync-enrollments', () => {
    const ENROLLMENT = (studentId) => ({
      studentId,
      studentEmail: `${studentId}@test.com`,
      studentName: studentId,
      enrolledAt: new Date().toISOString(),
      isActive: true,
      role: 'STUDENT',
    });

    let externalCourse;

    beforeEach(async () => {
      vi.clearAllMocks();
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);
      externalCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-cuid-ext-1' },
      });
    });

    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });

      const res = await request(profApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 403 for non-admin (student)', async () => {
      const { makeStudent } = await import('../helpers.js');
      const student = makeStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(403);
    });

    it('returns 400 for a non-numeric courseId', async () => {
      const res = await request(adminApp).post('/api/admin/courses/abc/sync-enrollments');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid course id/i);
    });

    it('returns 404 when the course does not exist', async () => {
      const res = await request(adminApp).post('/api/admin/courses/999999/sync-enrollments');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    // The "native course, no coreOfferingId" scenario this test covered is no
    // longer constructible: #1072 step 4 made `coreOfferingId` required at the
    // DB level, so every CourseOffering row is Core-linked by construction.
    // The route's `!course.coreOfferingId` guard is dead code now, harmlessly
    // so; left in place rather than removed as part of this migration.

    it('creates enrollment rows for new Core members and returns correct counts', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ENROLLMENT('user-a'),
        ENROLLMENT('user-b'),
      ]);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 2, created: 2, updated: 0, deleted: 0, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows.map((r) => r.userId).sort()).toEqual(['user-a', 'user-b']);
    });

    it('removes stale local enrollments absent from Core active list', async () => {
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: externalCourse.id, userId: 'user-stale' },
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ENROLLMENT('user-a')]);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 1, created: 1, updated: 0, deleted: 1, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows.map((r) => r.userId)).toEqual(['user-a']);
    });

    it('creates new and deletes stale in the same sync pass', async () => {
      await prisma.courseEnrollment.createMany({
        data: [
          { courseOfferingId: externalCourse.id, userId: 'user-existing' },
          { courseOfferingId: externalCourse.id, userId: 'user-stale' },
        ],
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ENROLLMENT('user-existing'),
        ENROLLMENT('user-new'),
      ]);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 2, created: 1, updated: 0, deleted: 1, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows.map((r) => r.userId).sort()).toEqual(['user-existing', 'user-new']);
    });

    it('does not wipe local rows when Core returns an empty active list', async () => {
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: externalCourse.id, userId: 'user-local' },
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('does not wipe local rows when all Core enrollments are inactive', async () => {
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: externalCourse.id, userId: 'user-local' },
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ENROLLMENT('user-local'), isActive: false },
      ]);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('returns 502 when the Core client throws with status 502', async () => {
      const err = Object.assign(new Error('Upstream failed'), { status: 502 });
      listEduAiCourseEnrollmentsServiceKey.mockRejectedValue(err);

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/Upstream failed/);
    });

    it('returns 500 when the Core client throws without a status', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockRejectedValue(new Error('unexpected'));

      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/unexpected/);
    });

    it('is idempotent — running sync twice does not create duplicate rows', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ENROLLMENT('user-a')]);

      await request(adminApp).post(`/api/admin/courses/${externalCourse.id}/sync-enrollments`);
      const res = await request(adminApp).post(
        `/api/admin/courses/${externalCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows).toHaveLength(1);
    });
  });

  // ── UNIT_ADMIN enrollment management ─────────────────────────────

  describe('UNIT_ADMIN enrollment management', () => {
    let coscCourse;
    let mathCourse;
    let unitAdmin;
    let unitAdminApp;

    // `department` is Core-owned (#1072 step 4) — `isCourseAdmin` resolves it
    // live via `fetchCoreCourseSafe`, stubbed here per `coreOfferingId`.
    const departmentByCoreOfferingId = { 'core-cosc-101': 'COSC', 'core-math-101': 'MATH' };

    beforeEach(async () => {
      coscCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-cosc-101' },
      });
      mathCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-math-101' },
      });
      fetchCoreCourseSafe.mockImplementation(async (coreOfferingId) => ({
        id: coreOfferingId,
        department: departmentByCoreOfferingId[coreOfferingId] ?? null,
      }));
      unitAdmin = makeUnitAdmin(['COSC']);
      unitAdminApp = await createApp({ mockUser: unitAdmin });
    });

    it('UNIT_ADMIN lists enrollments for a course in their department', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: student.id, role: 'STUDENT' },
      });

      const res = await request(unitAdminApp).get(
        `/api/admin/courses/${coscCourse.id}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.enrolledStudents).toHaveLength(1);
      expect(res.body.enrolledStudents[0].id).toBe(student.id);
      expect(res.body.enrolledStudents[0].role).toBe('STUDENT');
    });

    it('returns removed students in availableStudents so they can be re-enrolled', async () => {
      const enrolledStudent = makeStudent({ id: 'student-enrolled-1' });
      const availableStudent = makeStudent({ id: 'student-available-1' });
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: enrolledStudent.id, role: 'STUDENT' },
      });

      stubCoreUsers([
        {
          id: enrolledStudent.id,
          name: enrolledStudent.name,
          email: enrolledStudent.email,
          role: 'STUDENT',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        {
          id: availableStudent.id,
          name: availableStudent.name,
          email: availableStudent.email,
          role: 'STUDENT',
          createdAt: '2026-06-02T12:00:00.000Z',
        },
        {
          id: 'instructor-1',
          name: 'Dr. Ada Lovelace',
          email: 'instructor.cs@eduai.local',
          role: 'INSTRUCTOR',
          createdAt: '2026-06-03T12:00:00.000Z',
        },
      ]);

      const res = await request(unitAdminApp).get(
        `/api/admin/courses/${coscCourse.id}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.availableStudents).toHaveLength(1);
      expect(res.body.availableStudents[0].id).toBe(availableStudent.id);

      // Every course has a coreOfferingId now (#1072 step 4), so the DELETE
      // route's Core write-through always runs — stub it to find the
      // enrollment being removed.
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValueOnce([
        { studentId: enrolledStudent.id, id: 'core-enrollment-remove-1' },
      ]);
      await request(unitAdminApp).delete(
        `/api/admin/courses/${coscCourse.id}/enrollments/${enrolledStudent.id}`,
      );

      stubCoreUsers([
        {
          id: enrolledStudent.id,
          name: enrolledStudent.name,
          email: enrolledStudent.email,
          role: 'STUDENT',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        {
          id: availableStudent.id,
          name: availableStudent.name,
          email: availableStudent.email,
          role: 'STUDENT',
          createdAt: '2026-06-02T12:00:00.000Z',
        },
      ]);

      const afterRemove = await request(unitAdminApp).get(
        `/api/admin/courses/${coscCourse.id}/enrollments`,
      );

      expect(afterRemove.status).toBe(200);
      expect(afterRemove.body.enrolledStudents).toHaveLength(0);
      expect(afterRemove.body.availableStudents).toHaveLength(2);
      expect(afterRemove.body.availableStudents.map((s) => s.id)).toEqual(
        expect.arrayContaining([enrolledStudent.id, availableStudent.id]),
      );
    });

    it('uses Core user names for enrolled students with user id fallback', async () => {
      const student = makeStudent({ id: 'seed_user_student_05', name: 'Alex Patel' });
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: student.id, role: 'STUDENT' },
      });

      stubCoreUsers([
        {
          id: student.id,
          name: student.name,
          email: 'alex.patel@eduai.local',
          role: 'STUDENT',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
      ]);

      const res = await request(unitAdminApp).get(
        `/api/admin/courses/${coscCourse.id}/enrollments`,
      );

      expect(res.status).toBe(200);
      expect(res.body.enrolledStudents[0]).toMatchObject({
        id: student.id,
        name: 'Alex Patel',
        email: 'alex.patel@eduai.local',
      });

      stubCoreUsers([]);

      const fallback = await request(unitAdminApp).get(
        `/api/admin/courses/${coscCourse.id}/enrollments`,
      );

      expect(fallback.body.enrolledStudents[0].name).toBe(student.id);
    });

    it('UNIT_ADMIN gets 403 for a course outside their department', async () => {
      const res = await request(unitAdminApp).get(
        `/api/admin/courses/${mathCourse.id}/enrollments`,
      );
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN enrolls a student in a COSC course', async () => {
      const student = makeStudent();
      const res = await request(unitAdminApp)
        .post(`/api/admin/courses/${coscCourse.id}/enrollments`)
        .send({ userId: student.id });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: coscCourse.id, userId: student.id } },
      });
      expect(row).not.toBeNull();
      expect(row.role).toBe('STUDENT');
    });

    it('UNIT_ADMIN can enroll with role TA', async () => {
      const ta = makeTA();
      const res = await request(unitAdminApp)
        .post(`/api/admin/courses/${coscCourse.id}/enrollments`)
        .send({ userId: ta.id, role: 'TA' });

      expect(res.status).toBe(201);

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: coscCourse.id, userId: ta.id } },
      });
      expect(row.role).toBe('TA');
    });

    it('UNIT_ADMIN gets 403 when enrolling on a course outside department', async () => {
      const student = makeStudent();
      const res = await request(unitAdminApp)
        .post(`/api/admin/courses/${mathCourse.id}/enrollments`)
        .send({ userId: student.id });
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN removes an enrollment from a COSC course', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: student.id, role: 'STUDENT' },
      });

      // Every course has a coreOfferingId now (#1072 step 4), so the DELETE
      // route's Core write-through always runs.
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValueOnce([
        { studentId: student.id, id: 'core-enrollment-remove-2' },
      ]);
      const res = await request(unitAdminApp).delete(
        `/api/admin/courses/${coscCourse.id}/enrollments/${student.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: coscCourse.id, userId: student.id } },
      });
      expect(row).toBeNull();
    });

    it('UNIT_ADMIN gets 403 when removing enrollment outside department', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: mathCourse.id, userId: student.id, role: 'STUDENT' },
      });

      const res = await request(unitAdminApp).delete(
        `/api/admin/courses/${mathCourse.id}/enrollments/${student.id}`,
      );
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN assigns TA role via PATCH …/role', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: student.id, role: 'STUDENT' },
      });

      // Every course has a coreOfferingId now (#1072 step 4), so the PATCH
      // route's Core write-through always runs.
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValueOnce([
        { studentId: student.id, id: 'core-enrollment-role-1' },
      ]);
      const res = await request(unitAdminApp)
        .patch(`/api/admin/courses/${coscCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'TA' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.role).toBe('TA');

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: coscCourse.id, userId: student.id } },
      });
      expect(row.role).toBe('TA');
    });

    it('UNIT_ADMIN removes TA role (back to STUDENT) via PATCH …/role', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: ta.id, role: 'TA' },
      });

      // Every course has a coreOfferingId now (#1072 step 4), so the PATCH
      // route's Core write-through always runs.
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValueOnce([
        { studentId: ta.id, id: 'core-enrollment-role-2' },
      ]);
      const res = await request(unitAdminApp)
        .patch(`/api/admin/courses/${coscCourse.id}/enrollments/${ta.id}/role`)
        .send({ role: 'STUDENT' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('STUDENT');
    });

    it('PATCH …/role returns 400 for invalid role value', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: coscCourse.id, userId: student.id, role: 'STUDENT' },
      });

      const res = await request(unitAdminApp)
        .patch(`/api/admin/courses/${coscCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'INSTRUCTOR' });

      expect(res.status).toBe(400);
    });

    it('PATCH …/role returns 404 when enrollment does not exist', async () => {
      const res = await request(unitAdminApp)
        .patch(`/api/admin/courses/${coscCourse.id}/enrollments/nonexistent-user/role`)
        .send({ role: 'TA' });
      expect(res.status).toBe(404);
    });

    it('PATCH …/role returns 403 for course outside department', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: mathCourse.id, userId: student.id, role: 'STUDENT' },
      });

      const res = await request(unitAdminApp)
        .patch(`/api/admin/courses/${mathCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'TA' });
      expect(res.status).toBe(403);
    });
  });

  // ── DELETE …/enrollments/:userId on EduAI-linked courses (#812) ───

  describe('DELETE …/enrollments/:userId on EduAI-linked course', () => {
    let externalCourse;
    let student;

    const CORE_ENROLLMENT_ID = 'core-enrollment-cuid-1';

    beforeEach(async () => {
      vi.clearAllMocks();
      student = makeStudent();
      externalCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-cuid-ext-1' },
      });
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: externalCourse.id, userId: student.id, role: 'STUDENT' },
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        {
          id: CORE_ENROLLMENT_ID,
          studentId: student.id,
          studentEmail: 'student@test.com',
          studentName: 'Student',
          enrolledAt: new Date().toISOString(),
          isActive: true,
          role: 'STUDENT',
        },
      ]);
      deleteCoreEnrollment.mockResolvedValue(null);
    });

    it('calls Core DELETE and removes the local mirror row on success', async () => {
      const res = await request(adminApp).delete(
        `/api/admin/courses/${externalCourse.id}/enrollments/${student.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(deleteCoreEnrollment).toHaveBeenCalledWith(
        'core-cuid-ext-1',
        CORE_ENROLLMENT_ID,
        expect.any(String),
      );

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row).toBeNull();
    });

    it('returns Core error and leaves local row in place when Core DELETE fails', async () => {
      const err = Object.assign(new Error('Forbidden'), { status: 403 });
      deleteCoreEnrollment.mockRejectedValue(err);

      const res = await request(adminApp).delete(
        `/api/admin/courses/${externalCourse.id}/enrollments/${student.id}`,
      );

      expect(res.status).toBe(403);

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row).not.toBeNull();
    });

    it('returns 404 when user has no enrollment in Core, without touching local rows', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);

      const res = await request(adminApp).delete(
        `/api/admin/courses/${externalCourse.id}/enrollments/${student.id}`,
      );

      expect(res.status).toBe(404);
      expect(deleteCoreEnrollment).not.toHaveBeenCalled();

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row).not.toBeNull();
    });
  });

  // ── PATCH …/role on EduAI-linked courses (#569) ───────────────────

  describe('PATCH …/role on EduAI-linked course', () => {
    let externalCourse;
    let student;

    const CORE_ENROLLMENT_ID = 'core-enrollment-cuid-1';

    beforeEach(async () => {
      vi.clearAllMocks();
      student = makeStudent();
      externalCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-cuid-ext-1' },
      });
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: externalCourse.id, userId: student.id, role: 'STUDENT' },
      });
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        {
          id: CORE_ENROLLMENT_ID,
          studentId: student.id,
          studentEmail: 'student@test.com',
          studentName: 'Student',
          enrolledAt: new Date().toISOString(),
          isActive: true,
          role: 'STUDENT',
        },
      ]);
      patchCoreEnrollmentRole.mockResolvedValue({ id: CORE_ENROLLMENT_ID, role: 'TA' });
    });

    it('calls Core PATCH and updates local role on success', async () => {
      const res = await request(adminApp)
        .patch(`/api/admin/courses/${externalCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'TA' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, role: 'TA' });
      expect(patchCoreEnrollmentRole).toHaveBeenCalledWith(
        'core-cuid-ext-1',
        CORE_ENROLLMENT_ID,
        'TA',
        expect.any(String),
      );

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row.role).toBe('TA');
    });

    it('returns Core error and leaves local DB unchanged when Core PATCH fails', async () => {
      const err = Object.assign(new Error('Forbidden'), { status: 403 });
      patchCoreEnrollmentRole.mockRejectedValue(err);

      const res = await request(adminApp)
        .patch(`/api/admin/courses/${externalCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'TA' });

      expect(res.status).toBe(403);

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row.role).toBe('STUDENT');
    });

    it('returns 404 when user has no enrollment in Core', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);

      const res = await request(adminApp)
        .patch(`/api/admin/courses/${externalCourse.id}/enrollments/${student.id}/role`)
        .send({ role: 'TA' });

      expect(res.status).toBe(404);
      expect(patchCoreEnrollmentRole).not.toHaveBeenCalled();

      const row = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: externalCourse.id, userId: student.id } },
      });
      expect(row.role).toBe('STUDENT');
    });
  });

  // ── GET /api/admin/ai-traces (AI oversight) ──────────────────────

  describe('GET /api/admin/ai-traces', () => {
    let seed;
    let activity;

    async function seedTrace(userId = 'stu_1') {
      return prisma.aiInteractionTrace.create({
        data: {
          mode: 'guide',
          userMessage: 'help',
          finalResponse: 'sure',
          finalOutcome: 'completed',
          iterationCount: 1,
          trace: [],
          userId,
          activityId: activity.id,
        },
      });
    }

    beforeEach(async () => {
      const prof = makeProfessor();
      seed = await seedMinimalCourse(prof.id);
      // `department` is Core-owned (#1072 step 4) — the ai-traces route
      // resolves it from one batched service-key catalog fetch (unified
      // contract), not a local column.
      listEduAiCoursesServiceKey.mockResolvedValue([
        { id: seed.course.coreOfferingId, name: 'Seeded Course', department: 'CPSC' },
      ]);
      activity = await prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
          instructionsMd: 'x',
          config: { question: 'q', questionType: 'MCQ', options: ['a'], answer: 0, hints: [] },
        },
      });
    });

    it('ADMIN gets recent traces (200)', async () => {
      await seedTrace();
      const res = await request(adminApp).get('/api/admin/ai-traces');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].mode).toBe('guide');
    });

    it('STUDENT gets 403', async () => {
      const app = await createApp({ mockUser: makeStudent() });
      const res = await request(app).get('/api/admin/ai-traces');
      expect(res.status).toBe(403);
    });

    it('INSTRUCTOR gets 403', async () => {
      const app = await createApp({ mockUser: makeProfessor() });
      const res = await request(app).get('/api/admin/ai-traces');
      expect(res.status).toBe(403);
    });

    it('TA gets 403', async () => {
      const app = await createApp({ mockUser: makeTA() });
      const res = await request(app).get('/api/admin/ai-traces');
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN with no authorized units gets an empty list', async () => {
      await seedTrace();
      const app = await createApp({ mockUser: makeUnitAdmin([]) });
      const res = await request(app).get('/api/admin/ai-traces');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('UNIT_ADMIN sees traces scoped to their authorized unit', async () => {
      await seedTrace();
      const app = await createApp({ mockUser: makeUnitAdmin(['CPSC']) });
      const res = await request(app).get('/api/admin/ai-traces');

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('UNIT_ADMIN requesting a unit they are not authorized for gets 403', async () => {
      const app = await createApp({ mockUser: makeUnitAdmin(['CPSC']) });
      const res = await request(app).get('/api/admin/ai-traces?unit=MATH');
      expect(res.status).toBe(403);
    });

    it('400 when courseId is not a number', async () => {
      const res = await request(adminApp).get('/api/admin/ai-traces?courseId=abc');
      expect(res.status).toBe(400);
    });
  });
});
