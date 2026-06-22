import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, makeStudent, makeTA, makeUnitAdmin, truncateAll, prisma } from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
  listEduAiCourses: vi.fn(),
  findEduAiCourseById: vi.fn(),
  listEduAiCourseTopics: vi.fn(),
  listEduAiModels: vi.fn(),
  getEduAiBaseUrl: vi.fn(() => 'http://localhost:5174/api'),
  getEduAiChatUrl: vi.fn(() => 'http://localhost:5174/api/chat'),
  postCoreBugReport: vi.fn(),
  listCoreAdminUsers: vi.fn().mockResolvedValue([]),
  listCourseTestableQuestions: vi.fn(),
  patchCoreEnrollmentRole: vi.fn(),
}));

import {
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  patchCoreEnrollmentRole,
} from '../../src/services/eduaiClient.js';

describe('Admin routes', () => {
  let admin;
  let adminApp;

  beforeEach(async () => {
    await truncateAll();
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
      listCoreAdminUsers.mockResolvedValueOnce([
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
      expect(listCoreAdminUsers).toHaveBeenCalledWith(expect.any(String));
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({
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
          data: { title: 'Admin Test Course', description: 'desc', isPublished: true },
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
        data: {
          title: 'EduAI Course',
          description: 'imported',
          isPublished: true,
          externalId: 'core-cuid-ext-1',
          externalSource: 'EDUAI',
        },
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

    it('returns 400 when course is native (no externalId)', async () => {
      const nativeCourse = await prisma.courseOffering.create({
        data: { title: 'Native', description: '', isPublished: false },
      });

      const res = await request(adminApp).post(
        `/api/admin/courses/${nativeCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not imported/i);
    });

    it('returns 400 when externalSource is not EDUAI', async () => {
      const canvasCourse = await prisma.courseOffering.create({
        data: {
          title: 'Canvas Course',
          description: '',
          isPublished: false,
          externalId: 'canvas-123',
          externalSource: 'CANVAS',
        },
      });

      const res = await request(adminApp).post(
        `/api/admin/courses/${canvasCourse.id}/sync-enrollments`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not imported/i);
    });

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

    beforeEach(async () => {
      coscCourse = await prisma.courseOffering.create({
        data: { title: 'COSC 101', isPublished: true, department: 'COSC' },
      });
      mathCourse = await prisma.courseOffering.create({
        data: { title: 'MATH 101', isPublished: true, department: 'MATH' },
      });
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

      listCoreAdminUsers.mockResolvedValueOnce([
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

      await request(unitAdminApp).delete(
        `/api/admin/courses/${coscCourse.id}/enrollments/${enrolledStudent.id}`,
      );

      listCoreAdminUsers.mockResolvedValueOnce([
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

      listCoreAdminUsers.mockResolvedValueOnce([
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

      listCoreAdminUsers.mockResolvedValueOnce([]);

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

  // ── PATCH …/role on EduAI-linked courses (#569) ───────────────────

  describe('PATCH …/role on EduAI-linked course', () => {
    let externalCourse;
    let student;

    const CORE_ENROLLMENT_ID = 'core-enrollment-cuid-1';

    beforeEach(async () => {
      vi.clearAllMocks();
      student = makeStudent();
      externalCourse = await prisma.courseOffering.create({
        data: {
          title: 'EduAI Course',
          description: 'imported',
          isPublished: true,
          externalId: 'core-cuid-ext-1',
          externalSource: 'EDUAI',
        },
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
});
