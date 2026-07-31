import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, makeTA, makeAdmin, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

// `isPublished` (and `code`, used for AI-prompt context) are Core-owned
// (#1072 step 2/4) — the publish gate on every question/AI-tutoring route
// below resolves them live via `fetchCoreCourseSafe`, not a local column.
// Default every seeded course to published so the bulk of these tests keep
// their pre-#1072 behavior; individual "unpublished" tests override this.
vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCoreCourseSafe: vi.fn() };
});

import { fetchCoreCourseSafe } from '../../src/services/eduaiClient.js';

describe('Activities routes', () => {
  let prof;
  let seed; // { user, course, module, lesson, topic }
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });
    vi.mocked(fetchCoreCourseSafe).mockImplementation(async (coreOfferingId) => ({
      id: coreOfferingId,
      isPublished: true,
    }));
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
      expect(res.body.total).toBe(1);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]).toMatchObject({
        question: 'What is 2+2?',
        type: 'MCQ',
        mainTopic: { id: seed.topic.id, name: 'Test Topic' },
      });
      // professor response should NOT have completionStatus
      expect(res.body.data[0].completionStatus).toBeUndefined();
    });

    it('student gets completionStatus field', async () => {
      await createActivityInDb();
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/lessons/${seed.lesson.id}/activities`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data.length).toBe(1);
      // Should have completionStatus (defaults to not_attempted)
      expect(res.body.data[0].completionStatus).toBe('not_attempted');
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
      expect(res.body.total).toBe(1);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].completionStatus).toBeUndefined();
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
        data: { coreOfferingId: 'core-other-course' },
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

    it('returns 400 for a non-numeric lesson id', async () => {
      const res = await request(profApp).post('/api/lessons/not-a-number/activities').send({
        question: 'Q?',
        mainTopicId: seed.topic.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid lesson id/i);
    });

    it('returns 400 for an invalid payload (missing question)', async () => {
      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        mainTopicId: seed.topic.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid payload/i);
    });

    it('returns 404 when the lesson does not exist', async () => {
      const res = await request(profApp).post('/api/lessons/999999/activities').send({
        question: 'Q?',
        mainTopicId: seed.topic.id,
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 when the caller does not instruct the lesson course', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'Q?',
        mainTopicId: seed.topic.id,
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 for a cross-course secondaryTopicIds entry', async () => {
      const otherCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-other-course-secondary' },
      });
      const otherTopic = await prisma.topic.create({
        data: { name: 'Alien Secondary Topic', courseOfferingId: otherCourse.id },
      });

      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'Cross course secondary?',
        mainTopicId: seed.topic.id,
        secondaryTopicIds: [otherTopic.id],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/secondaryTopicIds/i);
    });

    it('creates an activity with non-empty secondaryTopicIds and persists the join rows', async () => {
      const topicB = await prisma.topic.create({
        data: { name: 'Topic B', courseOfferingId: seed.course.id },
      });

      const res = await request(profApp).post(`/api/lessons/${seed.lesson.id}/activities`).send({
        question: 'What is friction?',
        mainTopicId: seed.topic.id,
        secondaryTopicIds: [topicB.id],
      });

      expect(res.status).toBe(201);
      expect(res.body.secondaryTopics).toHaveLength(1);
      expect(res.body.secondaryTopics[0].id).toBe(topicB.id);

      const joinRows = await prisma.activitySecondaryTopic.findMany({
        where: { activityId: res.body.id },
      });
      expect(joinRows).toHaveLength(1);
      expect(joinRows[0].topicId).toBe(topicB.id);
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

    it('returns 404 for an unknown activity id', async () => {
      const res = await request(profApp).patch('/api/activities/999999').send({ title: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('ADMIN can PATCH an activity in any course', async () => {
      const adminApp = await createApp({ mockUser: makeAdmin() });
      const res = await request(adminApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ title: 'Admin edit' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Admin edit');
    });

    it('sets title to a trimmed string', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ title: '  My Title  ' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('My Title');
    });

    it('sets title to null explicitly', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ title: null });
      expect(res.status).toBe(200);
      expect(res.body.title).toBeNull();
    });

    it('whitespace-only title trims down to null', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ title: '   ' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBeNull();
    });

    it('returns 400 when question is whitespace-only', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ question: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/question must not be empty/i);
    });

    it('setting type to SHORT_TEXT nulls out options', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ type: 'SHORT_TEXT' });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('SHORT_TEXT');
      expect(res.body.options).toBeNull();
    });

    it('sets options explicitly to null', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ options: null });
      expect(res.status).toBe(200);
      expect(res.body.options).toBeNull();
    });

    it('updates answer alone', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ answer: 2 });
      expect(res.status).toBe(200);
      expect(res.body.answer).toBe(2);
    });

    it('trims and filters blank hints entries', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ hints: ['  Hint 1  ', '', '   ', 'Hint 2'] });
      expect(res.status).toBe(200);
      expect(res.body.hints).toEqual(['Hint 1', 'Hint 2']);
    });

    it('links a valid promptTemplateId', async () => {
      const template = await prisma.promptTemplate.create({
        data: { slug: `slug-${activity.id}`, name: 'Custom Template', systemPrompt: 'System.' },
      });
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ promptTemplateId: template.id });
      expect(res.status).toBe(200);
      expect(res.body.promptTemplateId).toBe(template.id);
      expect(res.body.promptTemplate).toMatchObject({ id: template.id, name: 'Custom Template' });
    });

    it('returns 400 for a non-existent promptTemplateId', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ promptTemplateId: 999999 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid promptTemplateId/i);
    });

    it('clears promptTemplateId when set to null', async () => {
      const template = await prisma.promptTemplate.create({
        data: { slug: `slug-clear-${activity.id}`, name: 'Template', systemPrompt: 'System.' },
      });
      await prisma.activity.update({ where: { id: activity.id }, data: { promptTemplateId: template.id } });

      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ promptTemplateId: null });
      expect(res.status).toBe(200);
      expect(res.body.promptTemplateId).toBeNull();
      expect(res.body.promptTemplate).toBeNull();
    });

    it('returns 400 when promptTemplateId is not a number or null', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ promptTemplateId: 'not-a-number' });
      expect(res.status).toBe(400);
    });

    it('normalizes customPrompt when set to a string', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPrompt: '  Be a helpful tutor.  ' });
      expect(res.status).toBe(200);
      expect(res.body.customPrompt).toBe('Be a helpful tutor.');
    });

    it('clears customPrompt when set to null', async () => {
      await prisma.activity.update({ where: { id: activity.id }, data: { customPrompt: 'Existing.' } });
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPrompt: null });
      expect(res.status).toBe(200);
      expect(res.body.customPrompt).toBeNull();
    });

    it('returns 400 when customPrompt is not a string or null', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPrompt: 42 });
      expect(res.status).toBe(400);
    });

    it('normalizes customPromptTitle when set to a string', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPromptTitle: '  Short Title  ' });
      expect(res.status).toBe(200);
      expect(res.body.customPromptTitle).toBe('Short Title');
    });

    it('clears customPromptTitle when set to null', async () => {
      await prisma.activity.update({ where: { id: activity.id }, data: { customPromptTitle: 'Existing' } });
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPromptTitle: null });
      expect(res.status).toBe(200);
      expect(res.body.customPromptTitle).toBeNull();
    });

    it('returns 400 when customPromptTitle is not a string or null', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ customPromptTitle: 42 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when mainTopicId is not a string', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ mainTopicId: 12345 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when mainTopicId belongs to a different course', async () => {
      const otherCourse = await prisma.courseOffering.create({
        data: { coreOfferingId: 'core-other-course-patch' },
      });
      const otherTopic = await prisma.topic.create({
        data: { name: 'Alien Topic', courseOfferingId: otherCourse.id },
      });

      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ mainTopicId: otherTopic.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must belong to the activity course/i);
    });

    it('returns 400 when secondaryTopicIds is not an array', async () => {
      const res = await request(profApp)
        .patch(`/api/activities/${activity.id}`)
        .send({ secondaryTopicIds: 'not-an-array' });
      expect(res.status).toBe(400);
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

    it('returns 401 for unauthenticated request', async () => {
      const noAuthApp = await createApp();

      const res = await request(noAuthApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(401);
    });

    it('rejects platform-role TA from submitting answers (403, no Submission row)', async () => {
      const ta = await enrollTa();
      const taApp = await createApp({ mockUser: ta });

      const res = await request(taApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);

      const submission = await prisma.submission.findFirst({
        where: { userId: ta.id, activityId: activity.id },
      });
      expect(submission).toBeNull();
    });

    it('rejects STUDENT-role user enrolled as TA from submitting answers (Core-style TA, 403 + no Submission row)', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: {
          courseOfferingId: seed.course.id,
          userId: student.id,
          role: 'TA',
        },
      });
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .post(`/api/questions/${activity.id}/answer`)
        .send({ answerOption: 1 });

      expect(res.status).toBe(403);

      const submission = await prisma.submission.findFirst({
        where: { userId: student.id, activityId: activity.id },
      });
      expect(submission).toBeNull();
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
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ id: seed.course.coreOfferingId, isPublished: false });
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
      expect(res.body.total).toBe(1);
      expect(res.body.data.some((a) => a.id === activity.id)).toBe(true);
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

  // ── GET /api/activities/importable ─────────────────────────────────

  describe('GET /api/activities/importable', () => {
    it('returns 400 when courseId is missing', async () => {
      const res = await request(profApp).get('/api/activities/importable');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/courseId is required/i);
    });

    it('returns 400 when courseId is non-numeric', async () => {
      const res = await request(profApp).get('/api/activities/importable?courseId=abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/courseId is required/i);
    });

    it('returns 400 when excludeLessonId is present but non-numeric', async () => {
      const res = await request(profApp).get(
        `/api/activities/importable?courseId=${seed.course.id}&excludeLessonId=abc`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/excludeLessonId must be a number/i);
    });

    it('returns 400 when page/pageSize are missing (pagination required)', async () => {
      const res = await request(profApp).get(`/api/activities/importable?courseId=${seed.course.id}`);
      expect(res.status).toBe(400);
    });

    it('returns 404 when the course does not exist', async () => {
      const res = await request(profApp).get(
        '/api/activities/importable?courseId=999999&page=1&pageSize=25',
      );
      expect(res.status).toBe(404);
    });

    it('returns 403 for an INSTRUCTOR who does not manage the course', async () => {
      const otherProf = makeProfessor();
      const otherApp = await createApp({ mockUser: otherProf });

      const res = await request(otherApp).get(
        `/api/activities/importable?courseId=${seed.course.id}&page=1&pageSize=25`,
      );
      expect(res.status).toBe(403);
    });

    it('lists an importable activity from another lesson the instructor manages', async () => {
      const activity = await createActivityInDb();

      const res = await request(profApp).get(
        `/api/activities/importable?courseId=${seed.course.id}&page=1&pageSize=25`,
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((a) => a.id === activity.id)).toBe(true);
    });

    it('excludeLessonId filters out activities belonging to that lesson', async () => {
      await createActivityInDb();

      const res = await request(profApp).get(
        `/api/activities/importable?courseId=${seed.course.id}&excludeLessonId=${seed.lesson.id}&page=1&pageSize=25`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.some((a) => a.lessonId === seed.lesson.id)).toBe(false);
    });

    it('ADMIN sees importable activities across every course', async () => {
      await createActivityInDb();
      const adminApp = await createApp({ mockUser: makeAdmin() });

      const res = await request(adminApp).get(
        `/api/activities/importable?courseId=${seed.course.id}&page=1&pageSize=25`,
      );

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Activity ordering (#1047) ─────────────────────────────────────

  describe('activity ordering', () => {
    it('appends new activities to the end of the lesson', async () => {
      // A pre-existing activity anchors position 0.
      const first = await createActivityInDb({ position: 0 });
      const res = await request(profApp)
        .post(`/api/lessons/${seed.lesson.id}/activities`)
        .send({
          title: 'Appended',
          mainTopicId: seed.topic.id,
          question: 'What is 3+3?',
          type: 'MCQ',
          options: ['5', '6', '7'],
          answer: 1,
          enableTeachMode: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.position).toBe(first.position + 1);
    });

    describe('PUT /api/lessons/:lessonId/activities/order', () => {
      async function seedThreeActivities() {
        const a = await createActivityInDb({ position: 0 });
        const b = await createActivityInDb({ position: 1 });
        const c = await createActivityInDb({ position: 2 });
        return { a, b, c };
      }

      it('reassigns positions 0..n-1 from the ordered id list', async () => {
        const { a, b, c } = await seedThreeActivities();
        const res = await request(profApp)
          .put(`/api/lessons/${seed.lesson.id}/activities/order`)
          .send({ orderedIds: [c.id, a.id, b.id] });

        expect(res.status).toBe(200);
        expect(res.body.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
        expect(res.body.map((x) => x.position)).toEqual([0, 1, 2]);

        const list = await request(profApp).get(`/api/lessons/${seed.lesson.id}/activities`);
        expect(list.body.total).toBe(3);
        expect(list.body.data.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
      });

      it('rejects an id set that does not match the lesson activities', async () => {
        const { a, b } = await seedThreeActivities();
        const res = await request(profApp)
          .put(`/api/lessons/${seed.lesson.id}/activities/order`)
          .send({ orderedIds: [a.id, b.id] });
        expect(res.status).toBe(400);
      });

      it('returns 403 for a TA', async () => {
        const { a, b, c } = await seedThreeActivities();
        const ta = await enrollTa();
        const taApp = await createApp({ mockUser: ta });
        const res = await request(taApp)
          .put(`/api/lessons/${seed.lesson.id}/activities/order`)
          .send({ orderedIds: [c.id, b.id, a.id] });
        expect(res.status).toBe(403);
      });
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
        typeof url === 'string' && url.includes('/completion') && opts?.method === 'POST',
    );
    const bankInjected = chatCalls.some(([, opts]) => {
      const body = JSON.parse(opts.body);
      return body.messages?.some((m) => m.content?.includes('What is O(log n)?'));
    });
    expect(bankInjected).toBe(true);
  });

  // The "coreOfferingId is null" scenario this test used to cover is no
  // longer constructible: #1072 step 4 made `coreOfferingId` required at the
  // DB level, so every CourseOffering row is Core-linked by construction.
  // `getCourseCode`'s falsy-coreOfferingId short-circuit (via
  // `resolveCoreCourseById`) is dead code now, harmlessly so; left in place
  // rather than removed as part of this migration.

  // #1021 review: assert the activities → EduAI wiring layer, not only
  // generate*Response with an explicitly passed courseId.
  it('/teach and /guide EduAI completion bodies include linked coreOfferingId as courseId (#1021)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ questions: [], total: 0 }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-1' }),
        }),
    );

    const teachRes = await request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });
    expect(teachRes.status).toBe(200);

    const teachCompletionBodies = fetch.mock.calls
      .filter(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('/api/completion') &&
          opts?.method === 'POST',
      )
      .map(([, opts]) => JSON.parse(opts.body));
    expect(teachCompletionBodies.length).toBeGreaterThan(0);
    for (const body of teachCompletionBodies) {
      expect(body.courseId).toBe('cuid-core-offering');
    }

    fetch.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ questions: [], total: 0 }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-2' }),
        }),
    );

    const guideRes = await request(studentApp)
      .post(`/api/activities/${activity.id}/guide`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Need a hint', knowledgeLevel: 'beginner', apiKey: 'test-key' });
    expect(guideRes.status).toBe(200);

    const guideCompletionBodies = fetch.mock.calls
      .filter(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('/api/completion') &&
          opts?.method === 'POST',
      )
      .map(([, opts]) => JSON.parse(opts.body));
    expect(guideCompletionBodies.length).toBeGreaterThan(0);
    for (const body of guideCompletionBodies) {
      expect(body.courseId).toBe('cuid-core-offering');
    }
  });

  // The "coreOfferingId is null" scenario is no longer constructible: #1072
  // step 4 made `coreOfferingId` required at the DB level, so every
  // CourseOffering row is Core-linked by construction. Linked-course
  // courseId forwarding is covered by the test above; omitting courseId for
  // an unlinked offering cannot be integration-tested against Prisma.

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

  // #999 PR review: a client abort (Stop button) must actually cancel the
  // upstream EduAI call, not just the browser fetch — otherwise the model
  // request keeps running server-side and can still persist a session/trace
  // for a turn the student already cancelled.
  it('a client abort (Stop button) cancels the upstream EduAI call and skips persistence', async () => {
    let onFetchCalled;
    const fetchCalled = new Promise((resolve) => {
      onFetchCalled = resolve;
    });
    let onSignalAborted;
    const signalAborted = new Promise((resolve) => {
      onSignalAborted = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((url, opts) => {
        if (typeof url === 'string' && url.includes('/completion')) {
          onFetchCalled();
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              onSignalAborted();
              const err = new Error('This operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ questions: [], total: 0 }),
        });
      }),
    );

    const pendingRequest = request(studentApp)
      .post(`/api/activities/${activity.id}/teach`)
      .set('Cookie', 'session=test-cookie')
      .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });
    // Swallow the client-side rejection from aborting below — this test only
    // cares about server-side behavior after the abort.
    pendingRequest.catch(() => {});

    // Wait until the server has actually reached the EduAI fetch call, then
    // abort the client request (simulates clicking Stop) and wait for the
    // forwarded AbortSignal to actually fire server-side.
    await fetchCalled;
    pendingRequest.abort();
    await signalAborted;

    // Let handleAiInteraction's catch/finally run after the fetch rejection.
    await new Promise((resolve) => setImmediate(resolve));

    const sessions = await prisma.aiChatSession.findMany({ where: { activityId: activity.id } });
    expect(sessions).toHaveLength(0);
  });

  // ── /teach, /guide: id / auth / payload validation ────────────────

  describe.each([
    ['teach', 'teach'],
    ['guide', 'guide'],
  ])('%s: id / auth / payload validation', (_label, mode) => {
    it(`returns 400 for a non-numeric activity id on /${mode}`, async () => {
      const res = await request(studentApp)
        .post(`/api/activities/not-a-number/${mode}`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(400);
    });

    it(`returns 401 for an unauthenticated request on /${mode}`, async () => {
      const noAuthApp = await createApp();
      const res = await request(noAuthApp)
        .post(`/api/activities/${activity.id}/${mode}`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(401);
    });

    it(`returns 404 for an unknown activity id on /${mode}`, async () => {
      const res = await request(studentApp)
        .post(`/api/activities/999999/${mode}`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(404);
    });

    it(`returns 400 for an invalid payload on /${mode}`, async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      const res = await request(studentApp).post(`/api/activities/${activity.id}/${mode}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid payload/i);
    });
  });

  // ── POST /api/activities/:activityId/custom ────────────────────────

  describe('POST /api/activities/:activityId/custom', () => {
    it('returns 400 for a non-numeric activity id', async () => {
      const res = await request(studentApp)
        .post('/api/activities/not-a-number/custom')
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(400);
    });

    it('returns 401 for an unauthenticated request', async () => {
      const noAuthApp = await createApp();
      const res = await request(noAuthApp)
        .post(`/api/activities/${activity.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown activity id', async () => {
      const res = await request(studentApp)
        .post('/api/activities/999999/custom')
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(404);
    });

    it('returns 403 for a non-student caller (INSTRUCTOR)', async () => {
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp)
        .post(`/api/activities/${activity.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only students/i);
    });

    it('returns 403 for a STUDENT not enrolled in the course', async () => {
      const outsider = makeStudent();
      const outsiderApp = await createApp({ mockUser: outsider });
      const res = await request(outsiderApp)
        .post(`/api/activities/${activity.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not enrolled/i);
    });

    it('returns 403 when the lesson is unpublished', async () => {
      await prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } });
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      const res = await request(studentApp)
        .post(`/api/activities/${activity.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    });

    it('returns 403 when the course is unpublished', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: false });
      const res = await request(studentApp)
        .post(`/api/activities/${activity.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    });

    it('returns 400 when custom mode is not enabled for the activity', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      const noCustom = await prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
          instructionsMd: 'No custom mode.',
          enableTeachMode: true,
          enableCustomMode: false,
          config: { questionType: 'MCQ', question: 'Q?', options: ['A', 'B'], answer: 0, hints: [] },
        },
      });
      const res = await request(studentApp)
        .post(`/api/activities/${noCustom.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/custom mode is not enabled/i);
    });

    it('returns 400 when custom mode is enabled but no customPrompt is configured', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      const noPrompt = await prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
          instructionsMd: 'Custom mode, no prompt.',
          enableTeachMode: true,
          enableCustomMode: true,
          customPrompt: null,
          config: { questionType: 'MCQ', question: 'Q?', options: ['A', 'B'], answer: 0, hints: [] },
        },
      });
      const res = await request(studentApp)
        .post(`/api/activities/${noPrompt.id}/custom`)
        .send({ message: 'Hi', knowledgeLevel: 'beginner', apiKey: 'test-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no custom prompt configured/i);
    });

    it('returns 400 for an invalid payload', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      const res = await request(studentApp).post(`/api/activities/${activity.id}/custom`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid payload/i);
    });

    it('returns 200 and forwards the composed custom prompt through EduAI (Core questions + completion)', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: true });
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ questions: [], total: 0 }),
            text: () => Promise.resolve(''),
          })
          .mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ content: 'AI response', chatId: 'chat-custom-1' }),
          }),
      );

      const res = await request(studentApp)
        .post(`/api/activities/${activity.id}/custom`)
        .set('Cookie', 'session=test-cookie')
        .send({ message: 'Explain sorting', knowledgeLevel: 'beginner', apiKey: 'test-key' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.message).toBe('string');
    });
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
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ id: seed.course.coreOfferingId, isPublished: false });
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
