import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { findEduAiCourseById } from '../../src/services/eduaiClient.js';
import { syncExternalCourseTopics } from '../../src/services/topicSync.js';
import { syncCourseEnrollments } from '../../src/services/enrollmentSync.js';

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
      expect(res.body.externalId).toBe('core-course-1');
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
        data: { externalId: 'core-1', externalSource: 'EDUAI' },
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

    it('returns 400 for a native course without Core externalId', async () => {
      const res = await request(profApp)
        .post(`/api/courses/${seed.course.id}/sync-enrollments`)
        .set('Cookie', 'session=valid');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not imported from EduAI/i);
    });
  });
});
