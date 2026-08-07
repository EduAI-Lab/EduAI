import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeAdmin,
  makeStudent,
  makeTA,
  makeUnitAdmin,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

// `department` is Core-owned (#1072 step 4) — `isCourseAdmin`'s self-resolve
// path fetches it live via `fetchCoreCourseSafe`.
vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCoreCourseSafe: vi.fn() };
});

import { fetchCoreCourseSafe } from '../../src/services/eduaiClient.js';

describe('Course analytics routes (#310)', () => {
  let prof;
  let seed;
  let profApp;
  let activity1;
  let activity2;
  let students;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });

    // Create a second lesson and two activities for richer test data
    const lesson2 = await prisma.lesson.create({
      data: {
        title: 'Lesson 2',
        contentMd: '',
        position: 1,
        isPublished: true,
        moduleId: seed.module.id,
      },
    });

    activity1 = await prisma.activity.create({
      data: {
        instructionsMd: 'Q1',
        position: 0,
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
      },
    });
    activity2 = await prisma.activity.create({
      data: {
        instructionsMd: 'Q2',
        position: 0,
        lessonId: lesson2.id,
        mainTopicId: seed.topic.id,
      },
    });

    // Enroll 3 students and seed submissions + metrics
    students = [];
    for (let i = 0; i < 3; i++) {
      const student = makeStudent();
      students.push(student);
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
      });
      await prisma.submission.create({
        data: { userId: student.id, activityId: activity1.id, attemptNumber: 1, isCorrect: i === 0 },
      });
      await prisma.activityStudentMetric.create({
        data: {
          userId: student.id,
          activityId: activity1.id,
          submissionCount: 1,
          correctSubmissionCount: i === 0 ? 1 : 0,
          incorrectSubmissionCount: i === 0 ? 0 : 1,
          helpRequestCount: i,
        },
      });
    }

    // Seed ActivityAnalytics for both activities
    await prisma.activityAnalytics.create({
      data: {
        activityId: activity1.id,
        submissionCount: 3,
        correctSubmissionCount: 1,
        incorrectSubmissionCount: 2,
        studentCount: 3,
      },
    });
    await prisma.activityAnalytics.create({
      data: {
        activityId: activity2.id,
        submissionCount: 0,
        studentCount: 0,
      },
    });
  });

  // ── GET /api/courses/:id/submissions ──────────────────────────────

  describe('GET /api/courses/:id/submissions', () => {
    it('INSTRUCTOR sees all submissions in the course', async () => {
      const res = await request(profApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0]).toMatchObject({ activityId: activity1.id });
    });

    it('filterable by activityId', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/submissions`)
        .query({ activityId: activity1.id });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('filterable by studentId', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/submissions`)
        .query({ studentId: students[0].id });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].userId).toBe(students[0].id);
    });

    it('TA can list submissions', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('ADMIN can list submissions', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(200);
    });

    it('UNIT_ADMIN in authorized department can list submissions', async () => {
      vi.mocked(fetchCoreCourseSafe).mockResolvedValue({
        id: seed.course.coreOfferingId,
        department: 'COSC',
      });
      const ua = makeUnitAdmin(['COSC']);
      const uaApp = await createApp({ mockUser: ua });
      const res = await request(uaApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(200);
    });

    it('student cannot list course submissions', async () => {
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get(`/api/courses/${seed.course.id}/submissions`);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/courses/:id/student-metrics ─────────────────────────

  describe('GET /api/courses/:id/student-metrics', () => {
    it('INSTRUCTOR sees aggregated per-student metrics', async () => {
      const res = await request(profApp).get(`/api/courses/${seed.course.id}/student-metrics`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      const first = res.body.find((m) => m.userId === students[0].id);
      expect(first).toMatchObject({
        userId: students[0].id,
        submissionCount: 1,
        correctSubmissionCount: 1,
        incorrectSubmissionCount: 0,
        helpRequestCount: 0,
      });
    });

    it('TA can access student-metrics (read parity, #938)', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).get(`/api/courses/${seed.course.id}/student-metrics`);
      expect(res.status).toBe(200);
    });

    it('ADMIN can access student-metrics', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp).get(`/api/courses/${seed.course.id}/student-metrics`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('student cannot access student-metrics', async () => {
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get(`/api/courses/${seed.course.id}/student-metrics`);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/courses/:id/analytics ───────────────────────────────

  describe('GET /api/courses/:id/analytics', () => {
    it('INSTRUCTOR sees per-activity analytics', async () => {
      const res = await request(profApp).get(`/api/courses/${seed.course.id}/analytics`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const a1 = res.body.find((a) => a.activityId === activity1.id);
      expect(a1).toMatchObject({
        submissionCount: 3,
        correctSubmissionCount: 1,
        studentCount: 3,
      });
    });

    it('TA can access analytics (read parity, #938)', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: ta.id, role: 'TA' },
      });
      const taApp = await createApp({ mockUser: ta });
      const res = await request(taApp).get(`/api/courses/${seed.course.id}/analytics`);
      expect(res.status).toBe(200);
    });

    it('ADMIN can access analytics', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });
      const res = await request(adminApp).get(`/api/courses/${seed.course.id}/analytics`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('student cannot access analytics', async () => {
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get(`/api/courses/${seed.course.id}/analytics`);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /me/submissions and /me/feedback (own-resource §310) ─────

  describe('GET /me/submissions — own-resource fallback', () => {
    it('student can see their own submissions', async () => {
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get('/api/me/submissions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].userId).toBe(students[0].id);
    });

    it('student can see own submissions even after enrollment is removed', async () => {
      // Remove enrollment to simulate inactive student
      await prisma.courseEnrollment.deleteMany({
        where: { userId: students[0].id, courseOfferingId: seed.course.id },
      });
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get('/api/me/submissions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns empty array when student has no submissions', async () => {
      const student = makeStudent();
      const studentApp = await createApp({ mockUser: student });
      const res = await request(studentApp).get('/api/me/submissions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('GET /me/feedback — own-resource fallback', () => {
    beforeEach(async () => {
      // Seed a submission first (required by feedback), then feedback
      await prisma.activityFeedback.create({
        data: {
          userId: students[0].id,
          activityId: activity1.id,
          rating: 4,
          note: 'Good activity',
        },
      });
    });

    it('student can see their own feedback', async () => {
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get('/api/me/feedback');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].userId).toBe(students[0].id);
      expect(res.body[0].rating).toBe(4);
    });

    it('student can see own feedback even after enrollment is removed', async () => {
      await prisma.courseEnrollment.deleteMany({
        where: { userId: students[0].id, courseOfferingId: seed.course.id },
      });
      const studentApp = await createApp({ mockUser: students[0] });
      const res = await request(studentApp).get('/api/me/feedback');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns empty array when student has no feedback', async () => {
      const student = makeStudent();
      const studentApp = await createApp({ mockUser: student });
      const res = await request(studentApp).get('/api/me/feedback');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
