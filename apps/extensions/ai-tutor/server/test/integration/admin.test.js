import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, makeAdmin, truncateAll, prisma } from '../helpers.js';

describe('Admin routes', () => {
  let admin;
  let adminApp;

  beforeEach(async () => {
    await truncateAll();
    admin = makeAdmin();
    await prisma.user.create({
      data: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: 'ADMIN',
      },
    });
    adminApp = await createApp({ mockUser: admin });
  });

  // ── GET /api/admin/users ──────────────────────────────────────────

  describe('GET /api/admin/users', () => {
    it('returns user list for admin', async () => {
      const res = await request(adminApp).get('/api/admin/users');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Should contain the admin user we created
      const found = res.body.find((u) => u.id === admin.id);
      expect(found).toBeDefined();
      expect(found.email).toBe(admin.email);
      expect(found.role).toBe('ADMIN');
      // mapAdminUser should include these fields
      expect(found).toHaveProperty('name');
      expect(found).toHaveProperty('createdAt');
      // Should NOT include password
      expect(found.password).toBeUndefined();
    });

    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      await prisma.user.create({
        data: {
          id: prof.id,
          name: prof.name,
          email: prof.email,
          role: 'PROFESSOR',
        },
      });
      const profApp = await createApp({ mockUser: prof });

      const res = await request(profApp).get('/api/admin/users');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/courses ────────────────────────────────────────

  describe('GET /api/admin/courses', () => {
    it('returns course list for admin', async () => {
      await prisma.courseOffering.create({
        data: { title: 'Admin Test Course', description: 'desc', isPublished: true },
      });

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
      await prisma.user.create({
        data: {
          id: prof.id,
          name: prof.name,
          email: prof.email,
          role: 'PROFESSOR',
        },
      });
      const profApp = await createApp({ mockUser: prof });

      const res = await request(profApp).get('/api/admin/courses');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/courses/:id/enrollments ────────────────────────

  describe('GET /api/admin/courses/:courseId/enrollments', () => {
    it('returns enrolled and available students', async () => {
      const course = await prisma.courseOffering.create({
        data: { title: 'Enrollment Course', description: 'desc', isPublished: true },
      });

      // Create two students: one enrolled, one not
      const enrolled = makeStudent();
      const available = makeStudent();

      await prisma.user.createMany({
        data: [
          { id: enrolled.id, name: enrolled.name, email: enrolled.email, role: 'STUDENT' },
          { id: available.id, name: available.name, email: available.email, role: 'STUDENT' },
        ],
      });

      await prisma.courseEnrollment.create({
        data: { courseOfferingId: course.id, userId: enrolled.id },
      });

      const res = await request(adminApp).get(`/api/admin/courses/${course.id}/enrollments`);

      expect(res.status).toBe(200);
      expect(res.body.courseId).toBe(course.id);
      expect(Array.isArray(res.body.enrolledStudents)).toBe(true);
      expect(Array.isArray(res.body.availableStudents)).toBe(true);

      const enrolledIds = res.body.enrolledStudents.map((u) => u.id);
      const availableIds = res.body.availableStudents.map((u) => u.id);

      expect(enrolledIds).toContain(enrolled.id);
      expect(availableIds).toContain(available.id);
      expect(availableIds).not.toContain(enrolled.id);
    });
  });

  // ── POST /api/admin/courses/:id/enrollments ───────────────────────

  describe('POST /api/admin/courses/:courseId/enrollments', () => {
    it('enrolls a student and returns 201', async () => {
      const course = await prisma.courseOffering.create({
        data: { title: 'Enroll Course', description: 'desc', isPublished: true },
      });

      const student = makeStudent();
      await prisma.user.create({
        data: {
          id: student.id,
          name: student.name,
          email: student.email,
          role: 'STUDENT',
        },
      });

      const res = await request(adminApp)
        .post(`/api/admin/courses/${course.id}/enrollments`)
        .send({ userId: student.id });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });

      // Verify the enrollment was created in the DB
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: course.id,
            userId: student.id,
          },
        },
      });
      expect(enrollment).not.toBeNull();
    });

    it('returns 400 when enrolling a non-student (professor)', async () => {
      const course = await prisma.courseOffering.create({
        data: { title: 'Enroll Course 2', description: 'desc', isPublished: true },
      });

      const prof = makeProfessor();
      await prisma.user.create({
        data: {
          id: prof.id,
          name: prof.name,
          email: prof.email,
          role: 'PROFESSOR',
        },
      });

      // Try to enroll the professor (who has role PROFESSOR, not STUDENT)
      const res = await request(adminApp)
        .post(`/api/admin/courses/${course.id}/enrollments`)
        .send({ userId: prof.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/student/i);
    });
  });

  // ── DELETE /api/admin/courses/:id/enrollments/:userId ─────────────

  describe('DELETE /api/admin/courses/:courseId/enrollments/:userId', () => {
    it('removes an enrollment', async () => {
      const course = await prisma.courseOffering.create({
        data: { title: 'Unenroll Course', description: 'desc', isPublished: true },
      });

      const student = makeStudent();
      await prisma.user.create({
        data: {
          id: student.id,
          name: student.name,
          email: student.email,
          role: 'STUDENT',
        },
      });
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: course.id, userId: student.id },
      });

      const res = await request(adminApp).delete(
        `/api/admin/courses/${course.id}/enrollments/${student.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // Verify the enrollment was removed from the DB
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: course.id,
            userId: student.id,
          },
        },
      });
      expect(enrollment).toBeNull();
    });
  });

  // ── PATCH /api/admin/users/:id/role ───────────────────────────────

  describe('PATCH /api/admin/users/:userId/role', () => {
    it('returns 410 (roles managed by EduAI)', async () => {
      const res = await request(adminApp)
        .patch(`/api/admin/users/${admin.id}/role`)
        .send({ role: 'PROFESSOR' });

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
});
