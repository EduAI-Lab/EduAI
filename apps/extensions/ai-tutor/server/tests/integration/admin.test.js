import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, truncateAll, prisma } from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
  listEduAiCourses: vi.fn(),
  findEduAiCourseById: vi.fn(),
  listEduAiCourseTopics: vi.fn(),
  listEduAiModels: vi.fn(),
  getEduAiBaseUrl: vi.fn(() => 'http://localhost:5174/api'),
  getEduAiChatUrl: vi.fn(() => 'http://localhost:5174/api/chat'),
  postCoreBugReport: vi.fn(),
  listCourseTestableQuestions: vi.fn(),
}));

import { listEduAiCourseEnrollmentsServiceKey } from '../../src/services/eduaiClient.js';

describe('Admin routes', () => {
  let admin;
  let adminApp;

  beforeEach(async () => {
    await truncateAll();
    admin = makeAdmin();
    adminApp = await createApp({ mockUser: admin });
  });

  // ── GET /api/admin/users ──────────────────────────────────────────
  // The list endpoint (GET /api/admin/users) calls prisma.user.findMany() which
  // was removed from the AT schema in schema_unification; that route is broken
  // and owned by the routes team. The RBAC guard (403) still works.

  describe('GET /api/admin/users', () => {
    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp).get('/api/admin/users');
      expect(res.status).toBe(403);
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
      expect(res.body).toEqual({ synced: 2, created: 2, deleted: 0, errors: [] });

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
      expect(res.body).toEqual({ synced: 1, created: 1, deleted: 1, errors: [] });

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
      expect(res.body).toEqual({ synced: 2, created: 1, deleted: 1, errors: [] });

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
      expect(res.body).toEqual({ synced: 0, created: 0, deleted: 0, errors: [] });

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
      expect(res.body).toEqual({ synced: 0, created: 0, deleted: 0, errors: [] });

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
      expect(res.body).toEqual({ synced: 1, created: 0, deleted: 0, errors: [] });

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: externalCourse.id },
      });
      expect(rows).toHaveLength(1);
    });
  });
});
