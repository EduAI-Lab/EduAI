import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, makeStudent, makeTA, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

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

    it('TA sees all lessons including unpublished', async () => {
      const unpublishedLesson = await prisma.lesson.create({
        data: {
          title: 'Unpublished Lesson',
          contentMd: 'Draft content',
          position: 1,
          isPublished: false,
          moduleId: seed.module.id,
        },
      });

      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/modules/${seed.module.id}/lessons`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const ids = res.body.map((l) => l.id);
      expect(ids).toContain(seed.lesson.id);
      expect(ids).toContain(unpublishedLesson.id);
      expect(res.body[0].progress).toBeUndefined();
    });

    it('TA cannot create a lesson', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .post(`/api/modules/${seed.module.id}/lessons`)
        .send({ title: 'TA Lesson', contentMd: '# TA', position: 1 });

      expect(res.status).toBe(403);
    });

    it('returns 403 for non-member', async () => {
      const otherProf = makeProfessor();
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

    it('TA sees unpublished lesson', async () => {
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/lessons/${seed.lesson.id}`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);
    });

    it('student gets 403 on unpublished lesson', async () => {
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/lessons/${seed.lesson.id}`);

      expect(res.status).toBe(403);
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

    it('TA cannot publish a lesson', async () => {
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).patch(`/api/lessons/${seed.lesson.id}/publish`);

      expect(res.status).toBe(403);
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

    it('TA cannot unpublish a lesson', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).patch(`/api/lessons/${seed.lesson.id}/unpublish`);

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/lessons/:id ───────────────────────────────────────

  describe('DELETE /api/lessons/:id', () => {
    it('professor can delete their own lesson', async () => {
      const res = await request(profApp).delete(`/api/lessons/${seed.lesson.id}`);
      expect(res.status).toBe(204);
      const found = await prisma.lesson.findUnique({ where: { id: seed.lesson.id } });
      expect(found).toBeNull();
    });

    it('TA cannot delete a lesson', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).delete(`/api/lessons/${seed.lesson.id}`);
      expect(res.status).toBe(403);
    });

    it('non-instructor cannot delete', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });
      const res = await request(otherApp).delete(`/api/lessons/${seed.lesson.id}`);
      expect(res.status).toBe(403);
    });

    it('ADMIN can delete any lesson', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp).delete(`/api/lessons/${seed.lesson.id}`);
      expect(res.status).toBe(204);
    });

    it('returns 404 for non-existent lesson', async () => {
      const res = await request(profApp).delete('/api/lessons/9999999');
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/lessons/:id ────────────────────────────────────────

  describe('PATCH /api/lessons/:id', () => {
    it('professor can update lesson title', async () => {
      const res = await request(profApp)
        .patch(`/api/lessons/${seed.lesson.id}`)
        .send({ title: 'Updated Title' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
    });

    it('professor can update contentMd and position', async () => {
      const res = await request(profApp)
        .patch(`/api/lessons/${seed.lesson.id}`)
        .send({ contentMd: 'New content', position: 5 });
      expect(res.status).toBe(200);
      expect(res.body.contentMd).toBe('New content');
      expect(res.body.position).toBe(5);
    });

    it('TA cannot PATCH a lesson', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp)
        .patch(`/api/lessons/${seed.lesson.id}`)
        .send({ title: 'TA Patch' });
      expect(res.status).toBe(403);
    });

    it('non-instructor cannot PATCH', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });
      const res = await request(otherApp)
        .patch(`/api/lessons/${seed.lesson.id}`)
        .send({ title: 'Other Patch' });
      expect(res.status).toBe(403);
    });

    it('ADMIN can PATCH any lesson', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp)
        .patch(`/api/lessons/${seed.lesson.id}`)
        .send({ title: 'Admin Edited' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Admin Edited');
    });

    it('returns 400 when nothing to update', async () => {
      const res = await request(profApp).patch(`/api/lessons/${seed.lesson.id}`).send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent lesson', async () => {
      const res = await request(profApp)
        .patch('/api/lessons/9999999')
        .send({ title: 'Ghost' });
      expect(res.status).toBe(404);
    });
  });
});
