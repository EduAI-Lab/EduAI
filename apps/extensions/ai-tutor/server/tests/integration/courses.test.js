import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ── Core write-through: publish state propagation (#477) ──────────────────────

describe('Course publish state — Core write-through (#477)', () => {
  let prof;
  let seed;
  let profApp;
  const CORE_OFFERING_ID = 'core-cuid-abc123';

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });

    // Link the seeded course to a Core offering so write-through is triggered.
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: CORE_OFFERING_ID, isPublished: false },
    });

    // setCoreCoursePublishState and listEduAiCourses check for this key before calling fetch.
    process.env.EDUAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EDUAI_API_KEY;
  });

  it('publish — calls Core publish endpoint and updates local isPublished', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(true);

    // Verify Core was called with the right URL and method.
    const coreCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(`/courses/${CORE_OFFERING_ID}/publish`),
    );
    expect(coreCalls).toHaveLength(1);
    expect(coreCalls[0][1].method).toBe('PATCH');

    // Verify local DB was also updated.
    const updated = await prisma.courseOffering.findUnique({ where: { id: seed.course.id } });
    expect(updated.isPublished).toBe(true);
  });

  it('unpublish — calls Core unpublish endpoint and cascades locally', async () => {
    // Seed as published first.
    await prisma.courseOffering.update({ where: { id: seed.course.id }, data: { isPublished: true } });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: CORE_OFFERING_ID, isPublished: false }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/unpublish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(false);

    const coreCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(`/courses/${CORE_OFFERING_ID}/unpublish`),
    );
    expect(coreCalls).toHaveLength(1);

    // Cascade: module and lesson should also be unpublished.
    const updatedModule = await prisma.module.findUnique({ where: { id: seed.module.id } });
    const updatedLesson = await prisma.lesson.findUnique({ where: { id: seed.lesson.id } });
    expect(updatedModule.isPublished).toBe(false);
    expect(updatedLesson.isPublished).toBe(false);
  });

  it('publish — surfaces Core errors as 500 without touching local DB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }));

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(500);

    // Local state must remain unchanged.
    const unchanged = await prisma.courseOffering.findUnique({ where: { id: seed.course.id } });
    expect(unchanged.isPublished).toBe(false);
  });

  it('publish — no Core call when coreOfferingId is null (native course)', async () => {
    // Remove the Core link — native course.
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: null, isPublished: false },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(profApp).patch(`/api/courses/${seed.course.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.isPublished).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('import — sets coreOfferingId and syncs isPublished from Core course', async () => {
    const EXTERNAL_COURSE_ID = 'core-cuid-xyz';
    const coreCourse = {
      id: EXTERNAL_COURSE_ID,
      code: 'COSC 999',
      name: 'Published Course',
      isPublished: true,
    };

    // Mock Core's listEduAiCourses response (used by import-external internally).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ courses: [coreCourse] }),
    }));

    const res = await request(profApp)
      .post('/api/courses/import-external')
      .send({ externalCourseId: EXTERNAL_COURSE_ID });

    expect(res.status).toBe(201);

    const imported = await prisma.courseOffering.findFirst({
      where: { externalId: EXTERNAL_COURSE_ID },
    });
    expect(imported).not.toBeNull();
    expect(imported.coreOfferingId).toBe(EXTERNAL_COURSE_ID);
    expect(imported.isPublished).toBe(true);
  });
});
