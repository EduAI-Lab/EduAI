import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

describe('Activities routes', () => {
  let prof;
  let seed; // { user, course, module, lesson, topic }
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });
  });

  // ── Helper to create an activity directly in DB ───────────────────

  async function createActivityInDb(overrides = {}) {
    return prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Answer the question.',
        config: {
          question: 'What is 2+2?',
          questionType: 'MCQ',
          options: ['3', '4', '5'],
          answer: 1,
          hints: [],
        },
        ...overrides,
      },
    });
  }

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

  // ── GET /api/lessons/:lessonId/activities ──────────────────────────

  describe('GET /api/lessons/:lessonId/activities', () => {
    it('returns mapped activities for professor', async () => {
      await createActivityInDb();

      const res = await request(profApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0]).toMatchObject({
        question: 'What is 2+2?',
        type: 'MCQ',
        mainTopic: { id: seed.topic.id, name: 'Test Topic' },
      });
      // professor response should NOT have completionStatus
      expect(res.body[0].completionStatus).toBeUndefined();
    });

    it('student gets completionStatus field', async () => {
      await createActivityInDb();
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      // Should have completionStatus (defaults to not_attempted)
      expect(res.body[0].completionStatus).toBe('not_attempted');
    });

    it('returns 403 for unpublished lesson (student)', async () => {
      await prisma.lesson.update({
        where: { id: seed.lesson.id },
        data: { isPublished: false },
      });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not published/i);
    });

    it('returns 403 for non-member', async () => {
      const outsider = makeProfessor();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/lessons/:lessonId/activities ────────────────────────

  describe('POST /api/lessons/:lessonId/activities', () => {
    it('creates an activity with mainTopicId', async () => {
      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'What is gravity?',
        mainTopicId: seed.topic.id,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        question: 'What is gravity?',
        type: 'MCQ',
        mainTopic: { id: seed.topic.id },
        enableTeachMode: true,
        enableGuideMode: true,
        enableCustomMode: false,
      });
      expect(res.body.id).toBeDefined();
    });

    it('returns 400 for cross-course topic', async () => {
      // Create a topic in a different course
      const otherCourse = await prisma.courseOffering.create({
        data: { title: 'Other Course', description: 'Other', isPublished: true },
      });
      const otherTopic = await prisma.topic.create({
        data: { name: 'Alien Topic', courseOfferingId: otherCourse.id },
      });

      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'Cross course?',
        mainTopicId: otherTopic.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mainTopicId/i);
    });

    it('returns 400 when all AI modes disabled', async () => {
      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'No modes?',
        mainTopicId: seed.topic.id,
        enableTeachMode: false,
        enableGuideMode: false,
        enableCustomMode: false,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/AI mode/i);
    });
  });

  // ── PATCH /api/activities/:id ─────────────────────────────────────

  describe('PATCH /api/activities/:id', () => {
    let activity;

    beforeEach(async () => {
      activity = await createActivityInDb();
    });

    it('updates config fields (question, type, hints)', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({
          question: 'Updated question?',
          type: 'SHORT_TEXT',
          hints: ['Hint 1', 'Hint 2'],
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        question: 'Updated question?',
        type: 'SHORT_TEXT',
        hints: ['Hint 1', 'Hint 2'],
      });
    });

    it('updates topics (full replacement of secondary topics)', async () => {
      const topicB = await prisma.topic.create({
        data: { name: 'Topic B', courseOfferingId: seed.course.id },
      });
      const topicC = await prisma.topic.create({
        data: { name: 'Topic C', courseOfferingId: seed.course.id },
      });

      // Set initial secondary topics
      await prisma.activitySecondaryTopic.create({
        data: { activityId: activity.id, topicId: topicB.id },
      });

      // Replace with topicC only
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ secondaryTopicIds: [topicC.id] });

      expect(res.status).toBe(200);
      expect(res.body.secondaryTopics).toHaveLength(1);
      expect(res.body.secondaryTopics[0].id).toBe(topicC.id);
    });

    it('returns 400 when all modes disabled', async () => {
      const res = await request(profApp).patch(`/api/activities/${activity.id}`).send({
        enableTeachMode: false,
        enableGuideMode: false,
        enableCustomMode: false,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/AI mode/i);
    });

    it('returns 400 with nothing to update', async () => {
      const res = await request(profApp).patch(`/api/activities/${activity.id}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/nothing to update/i);
    });

    it('returns 403 for non-instructor', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ question: 'Hacked?' });

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/activities/:id ────────────────────────────────────

  describe('DELETE /api/activities/:id', () => {
    it('deletes activity', async () => {
      const activity = await createActivityInDb();

      const res = await request(profApp).delete(`/api/activities/${activity.id}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify gone
      const gone = await prisma.activity.findUnique({ where: { id: activity.id } });
      expect(gone).toBeNull();
    });

    it('returns 403 for non-instructor', async () => {
      const activity = await createActivityInDb();
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).delete(`/api/activities/${activity.id}`);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/questions/:id/answer ────────────────────────────────

  describe('POST /api/questions/:id/answer', () => {
    let activity;

    beforeEach(async () => {
      activity = await createActivityInDb({
        config: {
          question: 'Pick the right one',
          questionType: 'MCQ',
          options: ['A', 'B', 'C'],
          answer: 1, // correct answer is index 1 ("B")
          hints: [],
        },
      });
    });

    it('returns isCorrect=true for correct MCQ answer', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.isCorrect).toBe(true);
      expect(res.body.submissionId).toBeDefined();
    });

    it('returns isCorrect=false for incorrect MCQ answer', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 0 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.isCorrect).toBe(false);
    });

    it('returns 403 for unenrolled user', async () => {
      const outsider = makeStudent();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/activities/:id/feedback ─────────────────────────────

  describe('POST /api/activities/:id/feedback', () => {
    let activity;
    let student;
    let studentApp;

    beforeEach(async () => {
      activity = await createActivityInDb({
        config: {
          question: 'Feedback test',
          questionType: 'MCQ',
          options: ['A', 'B'],
          answer: 0,
          hints: [],
        },
      });
      student = await enrollStudent();
      studentApp = await createApp({ mockUser: student });
    });

    it('returns 201 after submitting feedback, 409 on duplicate', async () => {
      // First, submit an answer so we have a submission
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 0 });

      // Submit feedback
      const res = await request(studentApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 4, note: 'Great activity!' });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.feedback).toMatchObject({
        rating: 4,
        note: 'Great activity!',
      });
      expect(res.body.feedback.id).toBeDefined();

      // Duplicate feedback should return 409
      const dup = await request(studentApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 5 });

      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatch(/already submitted/i);
    });

    it('returns 400 without a prior submission', async () => {
      // Try to leave feedback without answering first
      const res = await request(studentApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/submit an answer/i);
    });

    it('returns 403 for non-enrolled user (professor)', async () => {
      // Professor is an instructor, not an enrolled student
      const res = await request(profApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 5 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/enrolled students/i);
    });
  });
});
