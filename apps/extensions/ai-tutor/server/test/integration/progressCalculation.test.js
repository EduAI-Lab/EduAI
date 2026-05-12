import { describe, it, expect, beforeEach } from 'vitest';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';
import {
  calculateCourseProgress,
  calculateModuleProgress,
  calculateLessonProgress,
  getActivityCompletionStatuses,
} from '../../src/services/progressCalculation.js';

describe('progressCalculation service', () => {
  let prof;
  let seed; // { user, course, module, lesson, topic }
  let studentId;

  beforeEach(async () => {
    await truncateAll();

    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);

    // Create and enroll a student
    const student = makeStudent();
    await prisma.user.create({
      data: { id: student.id, name: student.name, email: student.email, role: 'STUDENT' },
    });
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id },
    });
    studentId = student.id;
  });

  // ── Helpers ────────────────────────────────────────────────────────

  async function createActivity(lessonId, overrides = {}) {
    return prisma.activity.create({
      data: {
        lessonId,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Instructions',
        config: { question: 'Q?', questionType: 'MCQ' },
        position: 0,
        ...overrides,
      },
    });
  }

  async function submitAnswer(activityId, userId, attemptNumber, isCorrect) {
    return prisma.submission.create({
      data: {
        userId,
        activityId,
        attemptNumber,
        isCorrect,
        response: {},
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // calculateCourseProgress
  // ══════════════════════════════════════════════════════════════════════

  describe('calculateCourseProgress', () => {
    it('returns zeroes when no activities exist', async () => {
      const result = await calculateCourseProgress(seed.course.id, studentId);

      expect(result).toEqual({ completed: 0, total: 0, percentage: 0 });
    });

    it('returns correct count when student has correct submissions', async () => {
      const a1 = await createActivity(seed.lesson.id);
      const a2 = await createActivity(seed.lesson.id);
      const a3 = await createActivity(seed.lesson.id);

      // Student got a1 correct, a2 incorrect, a3 not attempted
      await submitAnswer(a1.id, studentId, 1, true);
      await submitAnswer(a2.id, studentId, 1, false);

      const result = await calculateCourseProgress(seed.course.id, studentId);

      expect(result).toEqual({ completed: 1, total: 3, percentage: 33 });
    });

    it('only counts activities in published modules and lessons', async () => {
      // seed module and lesson are published
      const publishedActivity = await createActivity(seed.lesson.id);

      // Create an unpublished module with a lesson+activity
      const unpubModule = await prisma.module.create({
        data: {
          title: 'Unpublished Module',
          position: 1,
          isPublished: false,
          courseOfferingId: seed.course.id,
        },
      });
      const unpubLesson = await prisma.lesson.create({
        data: {
          title: 'Lesson in unpub',
          position: 0,
          isPublished: true,
          moduleId: unpubModule.id,
        },
      });
      await createActivity(unpubLesson.id);

      // Create a published module with an unpublished lesson
      const pubModule2 = await prisma.module.create({
        data: {
          title: 'Published Module 2',
          position: 2,
          isPublished: true,
          courseOfferingId: seed.course.id,
        },
      });
      const unpubLesson2 = await prisma.lesson.create({
        data: { title: 'Unpub lesson', position: 0, isPublished: false, moduleId: pubModule2.id },
      });
      await createActivity(unpubLesson2.id);

      await submitAnswer(publishedActivity.id, studentId, 1, true);

      const result = await calculateCourseProgress(seed.course.id, studentId);

      // Only the activity in the published module + published lesson counts
      expect(result).toEqual({ completed: 1, total: 1, percentage: 100 });
    });

    it('returns zeroes for null/undefined courseId or userId', async () => {
      const r1 = await calculateCourseProgress(null, studentId);
      expect(r1).toEqual({ completed: 0, total: 0, percentage: 0 });

      const r2 = await calculateCourseProgress(seed.course.id, undefined);
      expect(r2).toEqual({ completed: 0, total: 0, percentage: 0 });

      const r3 = await calculateCourseProgress(null, null);
      expect(r3).toEqual({ completed: 0, total: 0, percentage: 0 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // calculateModuleProgress
  // ══════════════════════════════════════════════════════════════════════

  describe('calculateModuleProgress', () => {
    it('counts activities in published lessons only', async () => {
      // seed.lesson is published
      const a1 = await createActivity(seed.lesson.id);

      // Create an unpublished lesson in the same module
      const unpubLesson = await prisma.lesson.create({
        data: { title: 'Unpub Lesson', position: 1, isPublished: false, moduleId: seed.module.id },
      });
      await createActivity(unpubLesson.id);

      await submitAnswer(a1.id, studentId, 1, true);

      const result = await calculateModuleProgress(seed.module.id, studentId);

      expect(result).toEqual({ completed: 1, total: 1, percentage: 100 });
    });

    it('returns zeroes when module has no activities', async () => {
      const result = await calculateModuleProgress(seed.module.id, studentId);

      expect(result).toEqual({ completed: 0, total: 0, percentage: 0 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // calculateLessonProgress
  // ══════════════════════════════════════════════════════════════════════

  describe('calculateLessonProgress', () => {
    it('counts all activities in the lesson (no published filter)', async () => {
      const a1 = await createActivity(seed.lesson.id);
      const a2 = await createActivity(seed.lesson.id);

      await submitAnswer(a1.id, studentId, 1, true);

      const result = await calculateLessonProgress(seed.lesson.id, studentId);

      expect(result).toEqual({ completed: 1, total: 2, percentage: 50 });
    });

    it('calculates percentage with Math.round', async () => {
      const a1 = await createActivity(seed.lesson.id);
      const a2 = await createActivity(seed.lesson.id);
      const a3 = await createActivity(seed.lesson.id);

      await submitAnswer(a1.id, studentId, 1, true);

      const result = await calculateLessonProgress(seed.lesson.id, studentId);

      // 1/3 = 0.3333... -> Math.round(33.33) = 33
      expect(result).toEqual({ completed: 1, total: 3, percentage: 33 });
    });

    it('returns zeroes for null lessonId', async () => {
      const result = await calculateLessonProgress(null, studentId);

      expect(result).toEqual({ completed: 0, total: 0, percentage: 0 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // getActivityCompletionStatuses
  // ══════════════════════════════════════════════════════════════════════

  describe('getActivityCompletionStatuses', () => {
    it('returns correct/incorrect/not_attempted statuses', async () => {
      const a1 = await createActivity(seed.lesson.id);
      const a2 = await createActivity(seed.lesson.id);
      const a3 = await createActivity(seed.lesson.id);

      await submitAnswer(a1.id, studentId, 1, true);
      await submitAnswer(a2.id, studentId, 1, false);
      // a3 not attempted

      const statuses = await getActivityCompletionStatuses([a1.id, a2.id, a3.id], studentId);

      expect(statuses).toBeInstanceOf(Map);
      expect(statuses.get(a1.id)).toBe('correct');
      expect(statuses.get(a2.id)).toBe('incorrect');
      expect(statuses.get(a3.id)).toBe('not_attempted');
    });

    it('uses the latest submission (highest attemptNumber)', async () => {
      const activity = await createActivity(seed.lesson.id);

      // First attempt: incorrect
      await submitAnswer(activity.id, studentId, 1, false);
      // Second attempt: correct
      await submitAnswer(activity.id, studentId, 2, true);

      const statuses = await getActivityCompletionStatuses([activity.id], studentId);

      expect(statuses.get(activity.id)).toBe('correct');
    });

    it('returns empty Map for empty or null activityIds', async () => {
      const r1 = await getActivityCompletionStatuses([], studentId);
      expect(r1).toBeInstanceOf(Map);
      expect(r1.size).toBe(0);

      const r2 = await getActivityCompletionStatuses(null, studentId);
      expect(r2).toBeInstanceOf(Map);
      expect(r2.size).toBe(0);
    });
  });
});
