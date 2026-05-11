import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

describe('Lessons routes', () => {
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

  // ── GET /api/modules/:moduleId/lessons ────────────────────────────

  describe('GET /api/modules/:moduleId/lessons', () => {
    it('professor sees all lessons (including unpublished)', async () => {
      // Add an unpublished lesson
      const unpublishedLesson = await prisma.lesson.create({
        data: {
          title: 'Unpublished Lesson',
          contentMd: 'Draft content',
          position: 1,
          isPublished: false,
          moduleId: seed.module.id,
        },
      });

      const res = await request(profApp).get(`/api/modules/${seed.module.id}/lessons`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const ids = res.body.map((l) => l.id);
      expect(ids).toContain(seed.lesson.id);
      expect(ids).toContain(unpublishedLesson.id);

      // Professor lessons have no progress object
      expect(res.body[0].progress).toBeUndefined();
    });

    it('student sees only published lessons with progress', async () => {
      // Add an unpublished lesson
      await prisma.lesson.create({
        data: {
          title: 'Unpublished Lesson',
          contentMd: 'Draft content',
          position: 1,
          isPublished: false,
          moduleId: seed.module.id,
        },
      });

      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/modules/${seed.module.id}/lessons`);

      expect(res.status).toBe(200);
      // Student should only see the published lesson
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.lesson.id);
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

      const res = await request(otherApp).get(`/api/modules/${seed.module.id}/lessons`);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/modules/:moduleId/lessons ───────────────────────────

  describe('POST /api/modules/:moduleId/lessons', () => {
    it('creates a lesson', async () => {
      const res = await request(profApp)
        .post(`/api/modules/${seed.module.id}/lessons`)
        .send({ title: 'New Lesson', contentMd: '# Hello', position: 3 });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Lesson');
      expect(res.body.contentMd).toBe('# Hello');
      expect(res.body.position).toBe(3);
      expect(res.body.isPublished).toBe(false);
      expect(res.body.moduleId).toBe(seed.module.id);
    });
  });

  // ── GET /api/lessons/:id ──────────────────────────────────────────

  describe('GET /api/lessons/:id', () => {
    it('returns a single lesson', async () => {
      const res = await request(profApp).get(`/api/lessons/${seed.lesson.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(seed.lesson.id);
      expect(res.body.title).toBe('Test Lesson');
    });
  });

  // ── PATCH /api/lessons/:id/publish ────────────────────────────────

  describe('PATCH /api/lessons/:id/publish', () => {
    it('publishes a lesson when parent course and module are published', async () => {
      // Unpublish the lesson first
      await prisma.lesson.update({
        where: { id: seed.lesson.id },
        data: { isPublished: false },
      });

      const res = await request(profApp).patch(`/api/lessons/${seed.lesson.id}/publish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(true);
    });

    it('returns 400 when parent module is not published', async () => {
      // Unpublish the parent module and the lesson
      await prisma.module.update({
        where: { id: seed.module.id },
        data: { isPublished: false },
      });
      await prisma.lesson.update({
        where: { id: seed.lesson.id },
        data: { isPublished: false },
      });

      const res = await request(profApp).patch(`/api/lessons/${seed.lesson.id}/publish`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/parent module is not published/i);
    });
  });

  // ── PATCH /api/lessons/:id/unpublish ──────────────────────────────

  describe('PATCH /api/lessons/:id/unpublish', () => {
    it('unpublishes a lesson', async () => {
      const res = await request(profApp).patch(`/api/lessons/${seed.lesson.id}/unpublish`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);

      // Verify it persisted in the database
      const updatedLesson = await prisma.lesson.findUnique({
        where: { id: seed.lesson.id },
      });
      expect(updatedLesson.isPublished).toBe(false);
    });
  });
});
