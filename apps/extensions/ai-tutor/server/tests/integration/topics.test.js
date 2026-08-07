import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeAdmin,
  makeStudent,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

const listEduAiCourseTopics = vi.fn();

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listEduAiCourseTopics: (...args) => listEduAiCourseTopics(...args),
  };
});

describe('Topics routes', () => {
  let prof;
  let seed;
  let app;

  beforeEach(async () => {
    await truncateAll();
    listEduAiCourseTopics.mockReset();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    app = await createApp({ mockUser: prof });
  });

  // ── GET /api/courses/:courseId/topics ──────────────────────────────

  describe('GET /api/courses/:courseId/topics', () => {
    it('returns topics for an authorized member', async () => {
      const res = await request(app).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]).toMatchObject({ id: seed.topic.id, name: 'Test Topic' });
    });

    it('returns 404 for a non-existent course', async () => {
      const res = await request(app).get('/api/courses/999999/topics');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 403 for a non-member', async () => {
      const outsider = makeProfessor();
      const outsiderApp = await createApp({ mockUser: outsider });

      // outsider exists in mock but is not an instructor or student on this course
      const res = await request(outsiderApp).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(403);
    });

    it('ADMIN (not enrolled/assigned) sees topics for any course (#781)', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0]).toMatchObject({ id: seed.topic.id, name: 'Test Topic' });
    });

    // #1072 step 4: every CourseOffering is a Core anchor (`coreOfferingId`
    // required + unique) — `seedMinimalCourse` already sets one, so there's
    // no "locally-authored course" state left to cover separately from the
    // imported-course cases below.

    it('auto-pulls the latest topics from Core for an imported course (#1031)', async () => {
      listEduAiCourseTopics.mockResolvedValue([{ id: 'core-1', name: 'Core-only Topic' }]);

      const res = await request(app).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(200);
      expect(listEduAiCourseTopics).toHaveBeenCalledWith(
        seed.course.coreOfferingId,
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(res.body.total).toBe(2);
      const names = res.body.data.map((t) => t.name);
      expect(names).toContain('Test Topic');
      expect(names).toContain('Core-only Topic');
    });

    it('falls back to the local mirror when Core is unreachable', async () => {
      listEduAiCourseTopics.mockRejectedValue(new Error('Core unavailable'));

      const res = await request(app).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data).toMatchObject([{ id: seed.topic.id, name: 'Test Topic' }]);
    });
  });

  // ── POST /api/courses/:courseId/topics ─────────────────────────────

  describe('POST /api/courses/:courseId/topics', () => {
    // #1072 step 4: `CourseOffering` is a pure anchor with a required,
    // unique `coreOfferingId` — every course is Core-linked ("imported") by
    // construction now, so the "native course, manual topic creation"
    // scenario this endpoint was built for can no longer occur. Manual
    // topic creation is unconditionally blocked (see the "imported courses"
    // test below); the former 201/409-on-duplicate cases tested a course
    // shape that no longer exists.

    it('returns 400 on empty name', async () => {
      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 403 for student role', async () => {
      const student = makeStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: 'Student Topic' });

      expect(res.status).toBe(403);
    });

    it('returns 403 for imported courses (coreOfferingId set) — the only shape a CourseOffering can have (#1072 step 4)', async () => {
      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: 'Blocked Topic' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/imported/i);
    });
  });

  // ── POST /api/courses/:courseId/topics/remap ──────────────────────

  describe('POST /api/courses/:courseId/topics/remap', () => {
    let topicA;
    let topicB;
    let activity;

    beforeEach(async () => {
      // topicA = seed.topic (already created)
      topicA = seed.topic;
      topicB = await prisma.topic.create({
        data: { name: 'Topic B', courseOfferingId: seed.course.id },
      });

      activity = await prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: topicA.id,
          instructionsMd: 'Test',
          config: { question: 'Q?', questionType: 'MCQ' },
        },
      });
    });

    it('remaps main topic and deletes old topic', async () => {
      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify activity now points to topicB
      const updated = await prisma.activity.findUnique({ where: { id: activity.id } });
      expect(updated.mainTopicId).toBe(topicB.id);

      // Old topic should be deleted
      const oldTopic = await prisma.topic.findUnique({ where: { id: topicA.id } });
      expect(oldTopic).toBeNull();
    });

    it('remaps secondary topics', async () => {
      // Assign topicA as a secondary topic on the activity (with topicB as main)
      await prisma.activity.update({
        where: { id: activity.id },
        data: { mainTopicId: topicB.id },
      });
      await prisma.activitySecondaryTopic.create({
        data: { activityId: activity.id, topicId: topicA.id },
      });

      const topicC = await prisma.topic.create({
        data: { name: 'Topic C', courseOfferingId: seed.course.id },
      });

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicC.id }] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Secondary topics should now include topicC, not topicA
      const secondaries = await prisma.activitySecondaryTopic.findMany({
        where: { activityId: activity.id },
      });
      const topicIds = secondaries.map((s) => s.topicId);
      expect(topicIds).toContain(topicC.id);
      expect(topicIds).not.toContain(topicA.id);
    });

    it('returns 400 for invalid/empty mappings', async () => {
      // Empty array
      let res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [] });
      expect(res.status).toBe(400);

      // Same fromTopicId and toTopicId (filtered out as invalid)
      res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicA.id }] });
      expect(res.status).toBe(400);
    });

    it('returns 403 for non-instructor', async () => {
      const student = makeStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(403);
    });

    it('returns 400 for a non-numeric course id', async () => {
      const res = await request(app)
        .post('/api/courses/not-a-number/topics/remap')
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid course id/i);
    });

    it('returns 404 for a non-existent course', async () => {
      const res = await request(app)
        .post('/api/courses/999999/topics/remap')
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(404);
    });

    it('returns 403 when the instructor is not assigned to this course', async () => {
      const outsider = makeProfessor();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(403);
    });

    it('returns 500 when fromTopicId does not belong to this course', async () => {
      const otherCourse = await seedMinimalCourse(prof.id);

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: otherCourse.topic.id, toTopicId: topicB.id }] });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/fromTopicId does not belong/i);
    });

    it('returns 500 when toTopicId does not belong to this course', async () => {
      const otherCourse = await seedMinimalCourse(prof.id);

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/remap`)
        .send({ mappings: [{ fromTopicId: topicA.id, toTopicId: otherCourse.topic.id }] });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/toTopicId does not belong/i);
    });
  });

  // ── POST /api/courses/:courseId/topics/sync (deprecated, still reachable) ─

  describe('POST /api/courses/:courseId/topics/sync', () => {
    it('returns 400 for a non-numeric course id', async () => {
      const res = await request(app).post('/api/courses/not-a-number/topics/sync').send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for a non-existent course', async () => {
      const res = await request(app).post('/api/courses/999999/topics/sync').send({});
      expect(res.status).toBe(404);
    });

    it('returns 403 when the instructor is not assigned to this course', async () => {
      const outsider = makeProfessor();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp)
        .post(`/api/courses/${seed.course.id}/topics/sync`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('syncs upstream topics and reports names missing locally', async () => {
      listEduAiCourseTopics.mockResolvedValue([{ id: 'core-1', name: 'New Upstream Topic' }]);

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/sync`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const names = res.body.topics.map((t) => t.name);
      expect(names).toContain('New Upstream Topic');
      expect(names).toContain('Test Topic');
      // 'Test Topic' never appeared upstream, so it's reported as missing.
      expect(res.body.missingTopics).toMatchObject([{ name: 'Test Topic' }]);
    });

    it('maps a failed Core sync to the error status carried on the thrown error', async () => {
      listEduAiCourseTopics.mockRejectedValue(Object.assign(new Error('Core down'), { status: 503 }));

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/sync`)
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/core down/i);
    });

    it('falls back to 502 when the sync failure has no status', async () => {
      listEduAiCourseTopics.mockRejectedValue(new Error('boom'));

      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics/sync`)
        .send({});

      expect(res.status).toBe(502);
    });
  });

  // ── GET/POST auth + validation edge cases ──────────────────────────

  describe('unauthenticated / malformed requests', () => {
    it('GET returns 400 for a non-numeric course id', async () => {
      const res = await request(app).get('/api/courses/not-a-number/topics');
      expect(res.status).toBe(400);
    });

    it('POST returns 400 for a non-numeric course id', async () => {
      const res = await request(app)
        .post('/api/courses/not-a-number/topics')
        .send({ name: 'X' });
      expect(res.status).toBe(400);
    });

    it('POST returns 404 for a non-existent course', async () => {
      const res = await request(app).post('/api/courses/999999/topics').send({ name: 'X' });
      expect(res.status).toBe(404);
    });

    it('POST returns 403 when the instructor is not assigned to this course', async () => {
      const outsider = makeProfessor();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: 'Outsider Topic' });

      expect(res.status).toBe(403);
    });

    it('GET returns 401 when no req.user is present on the request', async () => {
      // Mount the router directly with no auth middleware to exercise the
      // route's own defensive `if (!req.user)` check (unreachable through
      // the full app, which gates unauthenticated requests earlier).
      const express = (await import('express')).default;
      const { default: topicRoutes } = await import('../../src/routes/topics.js');
      const bareApp = express();
      bareApp.use(express.json());
      bareApp.use('/api', topicRoutes);

      const res = await request(bareApp).get(`/api/courses/${seed.course.id}/topics`);
      expect(res.status).toBe(401);
    });
  });
});
