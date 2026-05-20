import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeStudent,
  makeAdmin,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

describe('Courses routes', () => {
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

    it('returns 403 for ADMIN role', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get('/api/courses');

      expect(res.status).toBe(403);
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
    it('creates a new course with instructor assignment', async () => {
      const res = await request(profApp)
        .post('/api/courses')
        .send({ title: 'New Course', description: 'A brand new course' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Course');

      // Verify the instructor assignment was created
      const assignment = await prisma.courseInstructor.findFirst({
        where: { courseOfferingId: res.body.id, userId: prof.id },
      });
      expect(assignment).not.toBeNull();
      expect(assignment.role).toBe('LEAD');
    });

    it('returns 400 without title', async () => {
      const res = await request(profApp)
        .post('/api/courses')
        .send({ description: 'No title provided' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });
  });

  // ── PATCH /api/courses/:id ────────────────────────────────────────

  describe('PATCH /api/courses/:id', () => {
    it('updates title and description', async () => {
      const res = await request(profApp)
        .patch(`/api/courses/${seed.course.id}`)
        .send({ title: 'Updated Title', description: 'Updated Description' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
      expect(res.body.description).toBe('Updated Description');
    });

    it('returns 400 when nothing to update', async () => {
      const res = await request(profApp).patch(`/api/courses/${seed.course.id}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/nothing to update/i);
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
});
