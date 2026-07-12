import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, makeTA, makeAdmin, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

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

    it('TA sees activities even when lesson is unpublished (no completionStatus)', async () => {
      await createActivityInDb();
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });

      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].completionStatus).toBeUndefined();
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

    it('returns 403 for unenrolled STUDENT', async () => {
      const outsider = makeStudent();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
    });

    it('returns 403 for INSTRUCTOR role (§15: submission is student-only)', async () => {
      const res = await request(profApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only students/i);
    });

    it('allows enrolled TA to submit answers', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 403 when lesson is unpublished', async () => {
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    });

    it('returns 403 when module is unpublished', async () => {
      await prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    });

    it('returns 403 when course is unpublished', async () => {
      await prisma.courseOffering.update({ where: { id: seed.course.id }, data: { isPublished: false } });
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    });
  });

  // ── GET /api/activities/:id/submissions ──────────────────────────

  describe('GET /api/activities/:activityId/submissions', () => {
    let activity;

    beforeEach(async () => {
      activity = await createActivityInDb();
    });

    it('instructor gets all submissions', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      const res = await request(profApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].activityId).toBe(activity.id);
    });

    it('TA enrolled in the course gets all submissions', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('ADMIN (not enrolled/assigned) gets all submissions (#781)', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('student gets 403', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(403);
    });

    it('non-member gets 403', async () => {
      const outsider = makeStudent();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(403);
    });

    it('TA in a different course gets 403', async () => {
      const otherSeed = await seedMinimalCourse(null);
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: otherSeed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/activities/${activity.id}/submissions`);

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/activities/:id/feedback ─────────────────────────────

  describe('GET /api/activities/:activityId/feedback (instructor view)', () => {
    let activity;

    beforeEach(async () => {
      activity = await createActivityInDb();
    });

    it('instructor gets all feedback', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });
      await request(studentApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 4, note: 'Good' });

      const res = await request(profApp).get(`/api/activities/${activity.id}/feedback`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].rating).toBe(4);
    });

    it('TA enrolled in the course gets all feedback', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });
      await request(studentApp)
        .post(`/api/activities/${activity.id}/feedback`)
        .send({ rating: 5, note: 'Great' });

      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/activities/${activity.id}/feedback`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('student gets 403', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/activities/${activity.id}/feedback`);

      expect(res.status).toBe(403);
    });

    it('non-member gets 403', async () => {
      const outsider = makeStudent();
      const outsiderApp = await createApp({ mockUser: outsider });

      const res = await request(outsiderApp).get(`/api/activities/${activity.id}/feedback`);

      expect(res.status).toBe(403);
    });

    it('TA in a different course gets 403', async () => {
      const otherSeed = await seedMinimalCourse(null);
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: otherSeed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp).get(`/api/activities/${activity.id}/feedback`);

      expect(res.status).toBe(403);
    });
  });

  // ── Cross-course TA scoping (§19) ─────────────────────────────────

  describe('TA scoped to enrolled course only', () => {
    it('TA in course A cannot access activities in course B as TA', async () => {
      // Course A — ta enrolled as TA
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      // Course B — ta enrolled as STUDENT
      const seedB = await seedMinimalCourse(null);
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seedB.course.id, userId: ta.id, role: 'STUDENT' },
      });
      const activityInB = await prisma.activity.create({
        data: {
          lessonId: seedB.lesson.id,
          mainTopicId: seedB.topic.id,
          instructionsMd: 'Course B activity',
          config: {
            question: 'B?',
            questionType: 'MCQ',
            options: ['A', 'B'],
            answer: 0,
            hints: [],
          },
        },
      });

      // TA access to submissions in course B must be denied (enrolled as STUDENT, not TA)
      const res = await request(taApp).get(`/api/activities/${activityInB.id}/submissions`);
      expect(res.status).toBe(403);
    });

    it('TA in course A can access modules/lessons/activities in course A', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      const activity = await createActivityInDb();

      const res = await request(taApp).get(`/api/lessons/${seed.lesson.id}/activities`);
      expect(res.status).toBe(200);
      expect(res.body.some((a) => a.id === activity.id)).toBe(true);
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

  // ── PATCH /api/activities/:activityId/submissions/:submissionId (grade override) ──

  describe('PATCH /api/activities/:activityId/submissions/:submissionId', () => {
    let activity;
    let submissionId;

    beforeEach(async () => {
      activity = await createActivityInDb();
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      const answer = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 0 }); // wrong answer → isCorrect=false
      submissionId = answer.body.submissionId;
    });

    it('instructor overrides score and correctness (persisted)', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ score: 9.5, isCorrect: true });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(9.5);
      expect(res.body.isCorrect).toBe(true);

      const stored = await prisma.submission.findUnique({ where: { id: submissionId } });
      expect(stored.score).toBe(9.5);
      expect(stored.isCorrect).toBe(true);
    });

    it('enrolled TA can override', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ isCorrect: true });

      expect(res.status).toBe(200);
      expect(res.body.isCorrect).toBe(true);
    });

    it('ADMIN can override', async () => {
      const adminApp = await createApp({ mockUser: makeAdmin() });

      const res = await request(adminApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ score: 5 });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(5);
    });

    it('enrolled STUDENT gets 403 (staff-only)', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ isCorrect: true });

      expect(res.status).toBe(403);
    });

    it('INSTRUCTOR of a different course gets 403', async () => {
      const otherProf = makeProfessor();
      await seedMinimalCourse(otherProf.id);
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ isCorrect: true });

      expect(res.status).toBe(403);
    });

    it('TA enrolled in a different course gets 403', async () => {
      const otherSeed = await seedMinimalCourse(null);
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: otherSeed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ isCorrect: true });

      expect(res.status).toBe(403);
    });

    it('404 for an unknown submission', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}/submissions/99999`)
        .send({ isCorrect: true });

      expect(res.status).toBe(404);
    });

    it('400 when the body has nothing to update', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('400 when score is not a number', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ score: 'high' });

      expect(res.status).toBe(400);
    });

    it('silently ignores a feedback field (no grader-feedback column)', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}/submissions/${submissionId}`)
        .send({ isCorrect: true, feedback: 'nice work' });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('feedback');
    });
  });

  // ── POST /api/activities/:activityId/duplicate ────────────────────

  describe('POST /api/activities/:activityId/duplicate', () => {
    let activity;

    beforeEach(async () => {
      activity = await createActivityInDb();
    });

    it('instructor duplicates the activity into the same lesson (201, new id)', async () => {
      const res = await request(profApp).post(`/api/activities/${activity.id}/duplicate`);

      expect(res.status).toBe(201);
      expect(res.body.id).not.toBe(activity.id);

      const all = await prisma.activity.findMany({ where: { lessonId: seed.lesson.id } });
      expect(all.length).toBe(2);
    });

    it('STUDENT gets 403 (content-manager only)', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).post(`/api/activities/${activity.id}/duplicate`);

      expect(res.status).toBe(403);
    });

    it('INSTRUCTOR of a different course gets 403', async () => {
      const otherProf = makeProfessor();
      await seedMinimalCourse(otherProf.id);
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).post(`/api/activities/${activity.id}/duplicate`);

      expect(res.status).toBe(403);
    });

    it('404 for an unknown activity', async () => {
      const res = await request(profApp).post('/api/activities/99999/duplicate');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/lessons/:lessonId/activities/import ─────────────────

  describe('POST /api/lessons/:lessonId/activities/import', () => {
    let source;
    let targetLesson;

    beforeEach(async () => {
      source = await createActivityInDb();
      targetLesson = await prisma.lesson.create({
        data: {
          title: 'Target Lesson',
          contentMd: 'x',
          position: 1,
          isPublished: true,
          moduleId: seed.module.id,
        },
      });
    });

    it('instructor imports a source activity into another lesson (201)', async () => {
      const res = await request(profApp)
        .post(`/api/lessons/${targetLesson.id}/activities/import`)
        .send({ sourceActivityId: source.id });

      expect(res.status).toBe(201);

      const imported = await prisma.activity.findMany({ where: { lessonId: targetLesson.id } });
      expect(imported.length).toBe(1);
    });

    it('400 when sourceActivityId is missing', async () => {
      const res = await request(profApp)
        .post(`/api/lessons/${targetLesson.id}/activities/import`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('STUDENT gets 403 (content-manager only)', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/lessons/${targetLesson.id}/activities/import`)
        .send({ sourceActivityId: source.id });

      expect(res.status).toBe(403);
    });

    it('INSTRUCTOR who does not manage the target course gets 403', async () => {
      const otherProf = makeProfessor();
      await seedMinimalCourse(otherProf.id);
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp)
        .post(`/api/lessons/${targetLesson.id}/activities/import`)
        .send({ sourceActivityId: source.id });

      expect(res.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// Tutoring-flow question consumption (teach/guide/custom)
// ---------------------------------------------------------------------------
describe('Tutoring-flow: question consumption via Core', () => {
  let prof;
  let seed;
  let student;
  let studentApp;
  let activity;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);

    // Enroll a student — AI tutoring routes require STUDENT role + enrollment
    student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });
    studentApp = await createApp({ mockUser: student });

    // Provide a service key so listCourseTestableQuestions uses fetch rather than short-circuiting
    vi.stubEnv('EDUAI_API_KEY', 'test-service-key');

    // Seed the prompt templates required by generate*Response functions
    await prisma.promptTemplate.createMany({
      data: [
        { slug: 'learning-prompt', name: 'Learning', systemPrompt: 'You are a tutor.' },
        { slug: 'exercise-prompt', name: 'Exercise', systemPrompt: 'You are a guide.' },
        { slug: 'supervisor-prompt', name: 'Supervisor', systemPrompt: 'You are a supervisor.' },
      ],
    });

    // Link the course to a Core offering so the question-fetch path is exercised
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: 'cuid-core-offering' },
    });

    activity = await prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Teach me about sorting.',
        enableTeachMode: true,
        config: { questionType: 'MCQ', question: 'Q?', options: ['A', 'B'], answer: 0, hints: [] },
        customPrompt: 'Custom prompt here.',
        enableCustomMode: true,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('/teach fetches testable questions from Core and injects them into supervisor hidden context', async () => {
    const coreQuestions = [
      {
        id: 'cuid-q1',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        content: 'What is O(log n)?',
        choices: [{ letter: 'A', text: 'Linear' }, { letter: 'B', text: 'Logarithmic' }],
        answer: 'B',
      },
    ];

    // Call 1: Core questions list. All subsequent calls: EduAI chat (tutor + supervisor).
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ questions: coreQuestions, total: 1 }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-1' }),
        }),
    );

    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });

    expect(res.status).toBe(200);

    const fetchCalls = fetch.mock.calls;

    // Core questions endpoint called with correct courseId and testable=true
    const questionsFetchCall = fetchCalls.find(
      ([url]) =>
        typeof url === 'string' && url.includes('/questions') && url.includes('testable=true'),
    );
    expect(questionsFetchCall).toBeDefined();
    expect(questionsFetchCall[0]).toContain('courseId=cuid-core-offering');
    expect(questionsFetchCall[1].headers.Authorization).toBe('Bearer test-service-key');

    // Question bank content appears in at least one EduAI chat call (supervisor hidden context)
    const chatCalls = fetchCalls.filter(
      ([url, opts]) =>
        typeof url === 'string' && url.includes('/chat') && opts?.method === 'POST',
    );
    const bankInjected = chatCalls.some(([, opts]) => {
      const body = JSON.parse(opts.body);
      return body.messages?.some((m) => m.content?.includes('What is O(log n)?'));
    });
    expect(bankInjected).toBe(true);
  });

  it('/teach skips question fetch when coreOfferingId is null and proceeds normally', async () => {
    await prisma.courseOffering.update({
      where: { id: seed.course.id },
      data: { coreOfferingId: null },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-1' }),
    }));

    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });

    expect(res.status).toBe(200);

    // No Core questions call should have been made
    const questionsFetchCall = fetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/questions'),
    );
    expect(questionsFetchCall).toBeUndefined();
  });

  it('/teach proceeds with empty question bank and returns 200 when Core questions fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-1' }),
        }),
    );

    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §308 — enrollment + publish gate on teach / guide / custom
// ---------------------------------------------------------------------------
describe('teach/guide/custom: enrollment and publish gate (§308)', () => {
  let seed;
  let activity;

  beforeEach(async () => {
    await truncateAll();
    const prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);

    await prisma.promptTemplate.createMany({
      data: [
        { slug: 'learning-prompt', name: 'Learning', systemPrompt: 'You are a tutor.' },
        { slug: 'exercise-prompt', name: 'Exercise', systemPrompt: 'You are a guide.' },
        { slug: 'supervisor-prompt', name: 'Supervisor', systemPrompt: 'You are a supervisor.' },
      ],
    });

    activity = await prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Answer the question.',
        enableTeachMode: true,
        enableGuideMode: true,
        config: { questionType: 'MCQ', question: 'Q?', options: ['A', 'B'], answer: 0, hints: [] },
      },
    });
  });

  it('INSTRUCTOR gets 403 on /teach (student-only route)', async () => {
    const prof = makeProfessor();
    const profApp = await createApp({ mockUser: prof });
    const res = await request(profApp)
      .post(`/api/activities/${activity.id}/teach`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only students/i);
  });

  it('TA gets 403 on /teach', async () => {
    const ta = makeTA();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
    });
    const taApp = await createApp({ mockUser: ta });
    const res = await request(taApp)
      .post(`/api/activities/${activity.id}/teach`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only students/i);
  });

  it('unenrolled STUDENT gets 403 on /teach', async () => {
    const student = makeStudent();
    const studentApp = await createApp({ mockUser: student });
    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enrolled/i);
  });

  it('enrolled STUDENT gets 403 on /teach when lesson is unpublished', async () => {
    await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });
    const studentApp = await createApp({ mockUser: student });
    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not available/i);
  });

  it('enrolled STUDENT gets 403 on /teach when course is unpublished', async () => {
    await prisma.courseOffering.update({ where: { id: seed.course.id }, data: { isPublished: false } });
    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });
    const studentApp = await createApp({ mockUser: student });
    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not available/i);
  });

  it('INSTRUCTOR gets 403 on /guide (student-only route)', async () => {
    const prof = makeProfessor();
    const profApp = await createApp({ mockUser: prof });
    const res = await request(profApp)
      .post(`/api/activities/${activity.id}/guide`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only students/i);
  });

  it('unenrolled STUDENT gets 403 on /guide', async () => {
    const student = makeStudent();
    const studentApp = await createApp({ mockUser: student });
    const res = await request(studentApp)
      .post(`/api/activities/${activity.id}/guide`)
      .send({ message: 'Hi', knowledgeLevel: 'beginner' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enrolled/i);
  });
});
