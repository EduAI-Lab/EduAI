import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

describe('Topics routes', () => {
  let prof;
  let seed;
  let app;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    app = await createApp({ mockUser: prof });
  });

  // ── GET /api/courses/:courseId/topics ──────────────────────────────

  describe('GET /api/courses/:courseId/topics', () => {
    it('returns topics for an authorized member', async () => {
      const res = await request(app).get(`/api/courses/${seed.course.id}/topics`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0]).toMatchObject({ id: seed.topic.id, name: 'Test Topic' });
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
  });

  // ── POST /api/courses/:courseId/topics ─────────────────────────────

  describe('POST /api/courses/:courseId/topics', () => {
    it('creates a new topic and returns 201', async () => {
      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: 'New Topic' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'New Topic',
        courseOfferingId: seed.course.id,
      });
      expect(res.body.id).toBeDefined();
    });

    it('returns 409 on duplicate topic name', async () => {
      const res = await request(app)
        .post(`/api/courses/${seed.course.id}/topics`)
        .send({ name: 'Test Topic' }); // already seeded

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

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

    it('returns 403 for imported courses (externalId set)', async () => {
      // Set externalId on the course to make it "imported"
      await prisma.courseOffering.update({
        where: { id: seed.course.id },
        data: { externalId: 'ext-123', externalSource: 'eduai' },
      });

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
  });
});
