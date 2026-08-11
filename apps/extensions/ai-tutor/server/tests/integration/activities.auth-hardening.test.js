import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCoreCourseSafe: vi.fn() };
});

vi.mock('../../src/services/enrollmentSync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, authorizeLiveStudentEnrollment: vi.fn() };
});

import { fetchCoreCourseSafe } from '../../src/services/eduaiClient.js';
import { authorizeLiveStudentEnrollment } from '../../src/services/enrollmentSync.js';

describe('activity auth hardening', () => {
  let seed;

  async function createActivity(overrides = {}) {
    return prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Answer the question.',
        enableTeachMode: true,
        enableGuideMode: true,
        enableCustomMode: true,
        customPrompt: 'Help the student reason about this problem.',
        config: {
          question: 'What is 2 + 2?',
          questionType: 'MCQ',
          options: ['3', '4'],
          answer: 1,
          hints: [],
        },
        ...overrides,
      },
    });
  }

  async function enroll(user, role) {
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: user.id, role },
    });
  }

  beforeEach(async () => {
    await truncateAll();
    const professor = makeProfessor();
    seed = await seedMinimalCourse(professor.id);
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue({
      id: seed.course.coreOfferingId,
      isPublished: true,
    });
    vi.mocked(authorizeLiveStudentEnrollment).mockImplementation(
      async (_courseOfferingId, userId, { course, allowedRoles = ['STUDENT'] } = {}) => {
        const enrollment = course?.enrollments?.find((entry) => entry.userId === userId);
        const allowed = allowedRoles.includes(enrollment?.role);
        return {
          allowed,
          state: allowed ? 'allowed' : 'denied',
          role: enrollment?.role ?? null,
        };
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not expose the answer key in the student activity list', async () => {
    await prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Answer the question.',
        config: {
          question: 'What is 2 + 2?',
          questionType: 'MCQ',
          options: ['3', '4'],
          answer: 1,
          hints: [],
        },
      },
    });

    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });

    const res = await request(await createApp({ mockUser: student })).get(
      `/api/lessons/${seed.lesson.id}/activities`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty('answer');
  });

  it('retains the answer key for an instructor activity list', async () => {
    await createActivity();
    const professor = makeProfessor();
    await prisma.courseInstructor.create({
      data: { courseOfferingId: seed.course.id, userId: professor.id, role: 'LEAD' },
    });

    const res = await request(await createApp({ mockUser: professor })).get(
      `/api/lessons/${seed.lesson.id}/activities`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data[0].answer).toBe(1);
  });

  it('retains the answer key for a platform STUDENT serving as a course TA', async () => {
    await createActivity();
    const taEnrollmentStudent = makeStudent();
    await enroll(taEnrollmentStudent, 'TA');

    const res = await request(await createApp({ mockUser: taEnrollmentStudent })).get(
      `/api/lessons/${seed.lesson.id}/activities`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data[0].answer).toBe(1);
  });

  it.each(['teach', 'guide', 'custom'])(
    'rejects a platform STUDENT with a TA enrollment from /%s',
    async (mode) => {
      const activity = await createActivity();
      const taEnrollmentStudent = makeStudent();
      await enroll(taEnrollmentStudent, 'TA');

      const res = await request(await createApp({ mockUser: taEnrollmentStudent }))
        .post(`/api/activities/${activity.id}/${mode}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not enrolled|only students/i);
    },
  );

  it('rejects TA enrollment from student feedback and chat-session routes', async () => {
    const activity = await createActivity();
    const taEnrollmentStudent = makeStudent();
    await enroll(taEnrollmentStudent, 'TA');
    await prisma.aiChatSession.create({
      data: {
        userId: taEnrollmentStudent.id,
        activityId: activity.id,
        mode: 'teach',
        chatId: 'ta-enrollment-chat',
      },
    });

    const app = await createApp({ mockUser: taEnrollmentStudent });
    const feedback = await request(app)
      .post(`/api/activities/${activity.id}/feedback`)
      .send({ rating: 4 });
    expect(feedback.status).toBe(403);

    const sessions = await request(app).get(`/api/activities/${activity.id}/chat-sessions`);
    expect(sessions.status).toBe(403);

    const messages = await request(app).get(
      `/api/activities/${activity.id}/chat-sessions/ta-enrollment-chat/messages`,
    );
    expect(messages.status).toBe(403);
  });

  it('allows a published STUDENT to list chat sessions', async () => {
    const activity = await createActivity();
    const student = makeStudent();
    await enroll(student, 'STUDENT');
    await prisma.aiChatSession.create({
      data: {
        userId: student.id,
        activityId: activity.id,
        mode: 'teach',
        chatId: 'published-chat',
      },
    });

    const res = await request(await createApp({ mockUser: student })).get(
      `/api/activities/${activity.id}/chat-sessions`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].chatId).toBe('published-chat');
  });

  it('fails closed with a stable 503 when live enrollment authorization is unavailable', async () => {
    const activity = await createActivity();
    const student = makeStudent();
    await enroll(student, 'STUDENT');
    const app = await createApp({ mockUser: student });
    vi.mocked(authorizeLiveStudentEnrollment).mockResolvedValue({
      allowed: false,
      state: 'unavailable',
      role: null,
    });
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const beforeSubmissions = await prisma.submission.count({ where: { activityId: activity.id } });
    const response = await request(app)
      .post(`/api/questions/${activity.id}/answer`)
      .send({ answerOption: 1 });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Enrollment authorization unavailable',
      code: 'ENROLLMENT_AUTH_UNAVAILABLE',
    });
    expect(await prisma.submission.count({ where: { activityId: activity.id } })).toBe(
      beforeSubmissions,
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not proxy chat messages when live enrollment authorization is unavailable', async () => {
    const activity = await createActivity();
    const student = makeStudent();
    await enroll(student, 'STUDENT');
    await prisma.aiChatSession.create({
      data: {
        userId: student.id,
        activityId: activity.id,
        mode: 'teach',
        chatId: 'unavailable-chat',
      },
    });
    const app = await createApp({ mockUser: student });
    vi.mocked(authorizeLiveStudentEnrollment).mockResolvedValue({
      allowed: false,
      state: 'unavailable',
      role: null,
    });
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await request(app).get(
      `/api/activities/${activity.id}/chat-sessions/unavailable-chat/messages`,
    );

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ENROLLMENT_AUTH_UNAVAILABLE');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not write activity feedback when live enrollment authorization is unavailable', async () => {
    const activity = await createActivity();
    const student = makeStudent();
    await enroll(student, 'STUDENT');
    const app = await createApp({ mockUser: student });
    vi.mocked(authorizeLiveStudentEnrollment).mockResolvedValue({
      allowed: false,
      state: 'unavailable',
      role: null,
    });

    const response = await request(app)
      .post(`/api/activities/${activity.id}/feedback`)
      .send({ rating: 4 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ENROLLMENT_AUTH_UNAVAILABLE');
    expect(
      await prisma.activityFeedback.count({
        where: { activityId: activity.id, userId: student.id },
      }),
    ).toBe(0);
  });

  it('applies the publication gate to direct chat-message reads', async () => {
    const activity = await createActivity();
    const student = makeStudent();
    await enroll(student, 'STUDENT');
    await prisma.aiChatSession.create({
      data: {
        userId: student.id,
        activityId: activity.id,
        mode: 'teach',
        chatId: 'unpublished-message-chat',
      },
    });
    await prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } });
    const app = await createApp({ mockUser: student });
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await request(app).get(
      `/api/activities/${activity.id}/chat-sessions/unpublished-message-chat/messages`,
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/not available/i);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    [
      'course',
      async () => vi.mocked(fetchCoreCourseSafe).mockResolvedValue({ isPublished: false }),
    ],
    [
      'module',
      async () =>
        prisma.module.update({ where: { id: seed.module.id }, data: { isPublished: false } }),
    ],
    [
      'lesson',
      async () =>
        prisma.lesson.update({ where: { id: seed.lesson.id }, data: { isPublished: false } }),
    ],
  ])(
    'denies chat-session listing when the %s ancestor is unpublished',
    async (_ancestor, unpublish) => {
      const activity = await createActivity();
      const student = makeStudent();
      await enroll(student, 'STUDENT');
      await prisma.aiChatSession.create({
        data: {
          userId: student.id,
          activityId: activity.id,
          mode: 'teach',
          chatId: `${_ancestor}-chat`,
        },
      });
      await unpublish();

      const res = await request(await createApp({ mockUser: student })).get(
        `/api/activities/${activity.id}/chat-sessions`,
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available/i);
    },
  );
});
