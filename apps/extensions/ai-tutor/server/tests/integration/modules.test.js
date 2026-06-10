import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, makeStudent, makeTA, makeUnitAdmin, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

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

    it('TA sees all modules including unpublished (no progress object)', async () => {
      const unpublishedModule = await prisma.module.create({
        data: {
          title: 'Unpublished Module',
          description: 'Draft',
          position: 1,
          isPublished: false,
          courseOfferingId: seed.course.id,
        },
      });

      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const ids = res.body.map((m) => m.id);
      expect(ids).toContain(seed.module.id);
      expect(ids).toContain(unpublishedModule.id);
      // TAs have no progress object (elevated access, not student)
      expect(res.body[0].progress).toBeUndefined();
    });

    it('TA cannot POST (create) a module', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .post(`/api/courses/${seed.course.id}/modules`)
        .send({ title: 'TA Module', position: 5 });

      expect(res.status).toBe(403);
    });

    it('returns 403 for non-member', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(403);
    });

    it('returns 403 for TA not enrolled in this course', async () => {
      const otherSeed = await seedMinimalCourse(null);
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: otherSeed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      // TA is enrolled in otherCourse but NOT this course
      const res = await request(taApp).get(`/api/courses/${seed.course.id}/modules`);

      expect(res.status).toBe(403);
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

    it('TA sees unpublished module', async () => {
      await prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/modules/${seed.module.id}`);

      expect(res.status).toBe(200);
      expect(res.body.isPublished).toBe(false);
    });

    it('student gets 403 on unpublished module', async () => {
      await prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/modules/${seed.module.id}`);

      expect(res.status).toBe(403);
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

    it('TA cannot publish a module', async () => {
      await prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } });
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).patch(`/api/modules/${seed.module.id}/publish`);

      expect(res.status).toBe(403);
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

    it('TA cannot unpublish a module', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).patch(`/api/modules/${seed.module.id}/unpublish`);

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/modules/:id ───────────────────────────────────────

  describe('DELETE /api/modules/:id', () => {
    it('professor can delete their own module', async () => {
      const res = await request(profApp).delete(`/api/modules/${seed.module.id}`);
      expect(res.status).toBe(204);
      const found = await prisma.module.findUnique({ where: { id: seed.module.id } });
      expect(found).toBeNull();
    });

    it('deleting a module cascades to its lessons', async () => {
      const res = await request(profApp).delete(`/api/modules/${seed.module.id}`);
      expect(res.status).toBe(204);
      const lesson = await prisma.lesson.findUnique({ where: { id: seed.lesson.id } });
      expect(lesson).toBeNull();
    });

    it('TA cannot delete a module', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).delete(`/api/modules/${seed.module.id}`);
      expect(res.status).toBe(403);
    });

    it('non-instructor cannot delete', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });
      const res = await request(otherApp).delete(`/api/modules/${seed.module.id}`);
      expect(res.status).toBe(403);
    });

    it('ADMIN can delete any module', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp).delete(`/api/modules/${seed.module.id}`);
      expect(res.status).toBe(204);
    });

    it('returns 404 for non-existent module', async () => {
      const res = await request(profApp).delete('/api/modules/9999999');
      expect(res.status).toBe(404);
    });
  });

  // ── UNIT_ADMIN access ─────────────────────────────────────────────

  describe('UNIT_ADMIN access', () => {
    let coscCourse;
    let mathCourse;
    let unitAdmin;
    let unitAdminApp;

    beforeEach(async () => {
      coscCourse = await prisma.courseOffering.create({
        data: { title: 'COSC Course', isPublished: true, department: 'COSC' },
      });
      mathCourse = await prisma.courseOffering.create({
        data: { title: 'MATH Course', isPublished: true, department: 'MATH' },
      });
      await prisma.module.create({
        data: { title: 'COSC Module', position: 0, isPublished: true, courseOfferingId: coscCourse.id },
      });
      await prisma.module.create({
        data: { title: 'MATH Module', position: 0, isPublished: true, courseOfferingId: mathCourse.id },
      });
      unitAdmin = makeUnitAdmin(['COSC']);
      unitAdminApp = await createApp({ mockUser: unitAdmin });
    });

    it('sees modules for a course in their authorizedUnits', async () => {
      const res = await request(unitAdminApp).get(`/api/courses/${coscCourse.id}/modules`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].progress).toBeUndefined();
    });

    it('gets 403 for a course outside their authorizedUnits', async () => {
      const res = await request(unitAdminApp).get(`/api/courses/${mathCourse.id}/modules`);
      expect(res.status).toBe(403);
    });

    it('creates a module on a COSC course (issue #307 integration spec)', async () => {
      const res = await request(unitAdminApp)
        .post(`/api/courses/${coscCourse.id}/modules`)
        .send({ title: 'New COSC Module', position: 1 });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New COSC Module');
    });

    it('gets 403 when creating a module on a MATH course', async () => {
      const res = await request(unitAdminApp)
        .post(`/api/courses/${mathCourse.id}/modules`)
        .send({ title: 'New MATH Module', position: 1 });
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN with no authorizedUnits gets 403 on any course', async () => {
      const emptyAdmin = makeUnitAdmin([]);
      const emptyAdminApp = await createApp({ mockUser: emptyAdmin });
      const res = await request(emptyAdminApp).get(`/api/courses/${coscCourse.id}/modules`);
      expect(res.status).toBe(403);
    });

    it('UNIT_ADMIN cannot POST to a course with no department set', async () => {
      const noDeptCourse = await prisma.courseOffering.create({
        data: { title: 'No Dept Course', isPublished: true },
      });
      const res = await request(unitAdminApp)
        .post(`/api/courses/${noDeptCourse.id}/modules`)
        .send({ title: 'Module', position: 0 });
      expect(res.status).toBe(403);
    });
  });
});
