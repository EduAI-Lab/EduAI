import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

describe('Modules routes', () => {
  let prof;
  let seed; // { user, course, module, lesson, topic }
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });
  });

  // ── Helper to create and enroll a student ─────────────────────────

  async function enrollStudent() {
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
      data: {
        courseOfferingId: seed.course.id,
        userId: student.id,
      },
    });
    return student;
  }

  // ── GET /api/courses/:courseId/modules ─────────────────────────────

  describe('GET /api/courses/:courseId/modules', () => {
    it('professor sees all modules (including unpublished)', async () => {
      // Add an unpublished module
      const unpublishedModule = await prisma.module.create({
        data: {
          title: 'Unpublished Module',
          description: 'Draft',
          position: 1,
          isPublished: false,
          courseOfferingId: seed.course.id,
        },
      });

      const res = await request(profApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const ids = res.body.map((m) => m.id);
      expect(ids).toContain(seed.module.id);
      expect(ids).toContain(unpublishedModule.id);

      // Professor modules have no progress object
      expect(res.body[0].progress).toBeUndefined();
    });

    it('student sees only published modules with progress', async () => {
      // Add an unpublished module
      await prisma.module.create({
        data: {
          title: 'Unpublished Module',
          description: 'Draft',
          position: 1,
          isPublished: false,
          courseOfferingId: seed.course.id,
        },
      });

      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(200);
      // Student should only see the published module
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.module.id);
      expect(res.body[0].progress).toEqual(
        expect.objectContaining({
          completed: expect.any(Number),
          total: expect.any(Number),
          percentage: expect.any(Number),
        }),
      );
    });

    it('returns 403 for non-member', async () => {
      const otherProf = makeProfessor();
      await prisma.user.create({
        data: {
          id: otherProf.id,
          name: otherProf.name,
          email: otherProf.email,
          role: 'PROFESSOR',
        },
      });
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/courses/:courseId/modules ────────────────────────────

  describe('POST /api/courses/:courseId/modules', () => {
    it('creates a module', async () => {
      const res = await request(profApp)
        .post(`/api/courses/${seed.course.id}/modules`)
        .send({ title: 'New Module', description: 'Module desc', position: 5 });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Module');
      expect(res.body.description).toBe('Module desc');
      expect(res.body.position).toBe(5);
      expect(res.body.isPublished).toBe(false);
      expect(res.body.courseOfferingId).toBe(seed.course.id);
    });
  });

  // ── GET /api/modules/:id ──────────────────────────────────────────

  describe('GET /api/modules/:id', () => {
    it('returns a single module with courseOfferingId', async () => {
      const res = await request(profApp).get(`/api/modules/${seed.module.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(seed.module.id);
      expect(res.body.title).toBe('Test Module');
      expect(res.body.courseOfferingId).toBe(seed.course.id);
    });
  });

  // ── PATCH /api/modules/:id/publish ────────────────────────────────

  describe('PATCH /api/modules/:id/publish', () => {
    it('publishes a module when parent course is published', async () => {
      // Unpublish the module first
      await prisma.module.update({
        where: { id: seed.module.id },
        data: { isPublished: false },
      });

      const res = await request(profApp).patch(`/api/modules/${seed.module.id}/publish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(true);
    });

    it('returns 400 when parent course is not published', async () => {
      // Unpublish the parent course and the module
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { isPublished: false },
      });
      await prisma.module.update({
        where: { id: seed.module.id },
        data: { isPublished: false },
      });

      const res = await request(profApp).patch(`/api/modules/${seed.module.id}/publish`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/parent course is not published/i);
    });
  });

  // ── PATCH /api/modules/:id/unpublish ──────────────────────────────

  describe('PATCH /api/modules/:id/unpublish', () => {
    it('unpublishes a module and cascades to lessons', async () => {
      const res = await request(profApp).patch(`/api/modules/${seed.module.id}/unpublish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);

      // Verify lesson was unpublished
      const updatedLesson = await prisma.lesson.findUnique({
        where: { id: seed.lesson.id },
      });
      expect(updatedLesson.isPublished).toBe(false);
    });
  });
});
