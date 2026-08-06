/**
 * Drift guard for `calculateCourseProgressBatch` (#1208).
 *
 * The batch path exists to let `GET /api/courses?progress=` bucket the caller's
 * whole accessible set without the per-course N+1. It is only safe if it agrees
 * with `calculateCourseProgress` exactly — so most assertions here compare the
 * two directly on the same fixtures rather than restating expected numbers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeProfessor, makeStudent, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';
import {
  calculateCourseProgress,
  calculateCourseProgressBatch,
  progressBucket,
} from '../../src/services/progressCalculation.js';

describe('calculateCourseProgressBatch', () => {
  let prof;
  let a; // course A seed
  let b; // course B seed
  let studentId;
  let otherStudentId;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    a = await seedMinimalCourse(prof.id);
    b = await seedMinimalCourse(prof.id);

    const student = makeStudent();
    const other = makeStudent();
    studentId = student.id;
    otherStudentId = other.id;
    for (const seed of [a, b]) {
      await prisma.courseEnrollment.createMany({
        data: [
          { courseOfferingId: seed.course.id, userId: student.id },
          { courseOfferingId: seed.course.id, userId: other.id },
        ],
      });
    }
  });

  async function createActivity(seed, overrides = {}) {
    return prisma.activity.create({
      data: {
        lessonId: seed.lesson.id,
        mainTopicId: seed.topic.id,
        instructionsMd: 'Instructions',
        config: { question: 'Q?', questionType: 'MCQ' },
        position: 0,
        ...overrides,
      },
    });
  }

  async function submit(activityId, userId, attemptNumber, isCorrect) {
    return prisma.submission.create({
      data: { userId, activityId, attemptNumber, isCorrect, response: {} },
    });
  }

  /** Assert the batch agrees with the per-course function for every id. */
  async function expectAgreement(courseIds, userId) {
    const batch = await calculateCourseProgressBatch(courseIds, userId);
    for (const id of courseIds) {
      const single = await calculateCourseProgress(id, userId);
      expect(batch.get(id), `course ${id}`).toEqual(single);
    }
    return batch;
  }

  it('returns zeroes for every requested course when none have activities', async () => {
    const batch = await expectAgreement([a.course.id, b.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('agrees with calculateCourseProgress across a mixed set', async () => {
    // Course A: 3 activities, 2 correct → 67%
    const a1 = await createActivity(a);
    const a2 = await createActivity(a);
    await createActivity(a);
    await submit(a1.id, studentId, 1, true);
    await submit(a2.id, studentId, 1, true);

    // Course B: 2 activities, none attempted → 0%
    await createActivity(b);
    await createActivity(b);

    const batch = await expectAgreement([a.course.id, b.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 2, total: 3, percentage: 67 });
    expect(batch.get(b.course.id)).toEqual({ completed: 0, total: 2, percentage: 0 });
  });

  it('counts the LATEST attempt, so a later wrong answer un-completes an activity', async () => {
    const a1 = await createActivity(a);
    await submit(a1.id, studentId, 1, true);
    await submit(a1.id, studentId, 2, false);

    const batch = await expectAgreement([a.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 0, total: 1, percentage: 0 });
  });

  it('counts the LATEST attempt, so a later correct answer completes an activity', async () => {
    const a1 = await createActivity(a);
    await submit(a1.id, studentId, 1, false);
    await submit(a1.id, studentId, 2, true);

    const batch = await expectAgreement([a.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 1, total: 1, percentage: 100 });
  });

  it('excludes activities in unpublished lessons and unpublished modules', async () => {
    const published = await createActivity(a);
    await submit(published.id, studentId, 1, true);

    const draftLesson = await prisma.lesson.create({
      data: { title: 'Draft', position: 1, isPublished: false, moduleId: a.module.id },
    });
    const hidden = await createActivity(a, { lessonId: draftLesson.id });
    await submit(hidden.id, studentId, 1, true);

    const draftModule = await prisma.module.create({
      data: { title: 'Draft mod', position: 1, isPublished: false, courseOfferingId: a.course.id },
    });
    const draftModuleLesson = await prisma.lesson.create({
      data: { title: 'L', position: 0, isPublished: true, moduleId: draftModule.id },
    });
    await createActivity(a, { lessonId: draftModuleLesson.id });

    const batch = await expectAgreement([a.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 1, total: 1, percentage: 100 });
  });

  it('isolates users — another student\'s submissions do not count', async () => {
    const a1 = await createActivity(a);
    await submit(a1.id, otherStudentId, 1, true);

    const batch = await expectAgreement([a.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 0, total: 1, percentage: 0 });
  });

  it('does not leak completion across courses', async () => {
    const a1 = await createActivity(a);
    await createActivity(b);
    await submit(a1.id, studentId, 1, true);

    const batch = await expectAgreement([a.course.id, b.course.id], studentId);
    expect(batch.get(a.course.id)).toEqual({ completed: 1, total: 1, percentage: 100 });
    expect(batch.get(b.course.id)).toEqual({ completed: 0, total: 1, percentage: 0 });
  });

  it('returns an empty map for an empty id list and never queries', async () => {
    await expect(calculateCourseProgressBatch([], studentId)).resolves.toEqual(new Map());
  });

  it('returns zeroes when userId is missing', async () => {
    await createActivity(a);
    const batch = await calculateCourseProgressBatch([a.course.id], undefined);
    expect(batch.get(a.course.id)).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('de-dupes repeated ids and ignores non-integer ids', async () => {
    const batch = await calculateCourseProgressBatch(
      [a.course.id, a.course.id, null, undefined, 'x'],
      studentId,
    );
    expect([...batch.keys()]).toEqual([a.course.id]);
  });

  describe('progressBucket', () => {
    // These four cases are the contract shared with PROGRESS_FILTER in
    // app/routes/student.tsx — the frontend has a mirrored test.
    it('returns null when the course has no published activities', () => {
      expect(progressBucket({ completed: 0, total: 0, percentage: 0 })).toBeNull();
    });

    it('buckets an untouched course as not-started', () => {
      expect(progressBucket({ completed: 0, total: 3, percentage: 0 })).toBe('not-started');
    });

    it('buckets a partly-done course as in-progress', () => {
      expect(progressBucket({ completed: 1, total: 3, percentage: 33 })).toBe('in-progress');
    });

    it('buckets a fully-done course as completed', () => {
      expect(progressBucket({ completed: 3, total: 3, percentage: 100 })).toBe('completed');
    });
  });
});
