/**
 * Unit tests for importTaughtCoursesFromCore (AI Tutor server).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseOfferingFindFirst = vi.fn();
const courseOfferingFindMany = vi.fn();
const courseOfferingCreate = vi.fn();
const courseOfferingUpdate = vi.fn();
const courseInstructorCreate = vi.fn();
const courseInstructorFindFirst = vi.fn();
const courseEnrollmentUpsert = vi.fn();
const courseEnrollmentFindMany = vi.fn();
const courseEnrollmentDeleteMany = vi.fn();
const transaction = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: {
      findFirst: courseOfferingFindFirst,
      findMany: courseOfferingFindMany,
      create: courseOfferingCreate,
      update: courseOfferingUpdate,
    },
    courseInstructor: {
      findFirst: courseInstructorFindFirst,
      create: courseInstructorCreate,
    },
    courseEnrollment: {
      upsert: courseEnrollmentUpsert,
      findMany: courseEnrollmentFindMany,
      deleteMany: courseEnrollmentDeleteMany,
    },
    $transaction: transaction,
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourses: vi.fn(),
}));

vi.mock('../../src/services/topicSync.js', () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/enrollmentSync.js', () => ({
  syncCourseEnrollments: vi.fn().mockResolvedValue({ synced: 0, created: 0, deleted: 0, errors: [] }),
}));

const { listEduAiCourses } = await import('../../src/services/eduaiClient.js');
const {
  importEnrolledCoursesFromCore,
  importTaughtCoursesFromCore,
  userHasCoreTaEnrollment,
} = await import('../../src/services/importTaughtCoursesService.js');

describe('importTaughtCoursesFromCore (AI Tutor)', () => {
  const instructor = { id: 'prof-1', role: 'INSTRUCTOR' };

  beforeEach(() => {
    vi.clearAllMocks();
    courseOfferingFindMany.mockResolvedValue([]);
    courseOfferingFindFirst.mockResolvedValue(null);
    courseInstructorFindFirst.mockResolvedValue({ userId: 'prof-1' });
    courseOfferingUpdate.mockResolvedValue({});
    transaction.mockImplementation(async (fn) =>
      fn({
        courseOffering: { create: courseOfferingCreate },
        courseInstructor: { create: courseInstructorCreate },
      }),
    );
    courseOfferingCreate.mockResolvedValue({ id: 10, title: 'COSC 111 - Computing' });
    courseInstructorCreate.mockResolvedValue({});
    courseEnrollmentUpsert.mockResolvedValue({});
    courseEnrollmentFindMany.mockResolvedValue([]);
    courseEnrollmentDeleteMany.mockResolvedValue({ count: 0 });
  });

  it('skips auto-import for students', async () => {
    const result = await importTaughtCoursesFromCore({ id: 's1', role: 'STUDENT' }, 'session=abc');

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(listEduAiCourses).not.toHaveBeenCalled();
  });

  it('imports Core courses not yet present locally', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', code: 'COSC 111', name: 'Computing Science', callerEnrollmentRole: 'INSTRUCTOR' },
    ]);

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.imported).toBe(1);
    expect(courseOfferingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalId: 'core-1',
          externalSource: 'EDUAI',
        }),
      }),
    );
  });

  it('skips courses already imported by the instructor', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', code: 'COSC 111', name: 'Computing Science', callerEnrollmentRole: 'INSTRUCTOR' },
    ]);
    courseOfferingFindMany.mockResolvedValue([{ externalId: 'core-1' }]);

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(courseOfferingCreate).not.toHaveBeenCalled();
  });

  it('syncs isPublished from Core when the course is already linked locally', async () => {
    listEduAiCourses.mockResolvedValue([
      {
        id: 'core-1',
        code: 'COSC 111',
        name: 'Computing Science',
        callerEnrollmentRole: 'INSTRUCTOR',
        isPublished: true,
      },
    ]);
    courseOfferingFindMany
      .mockResolvedValueOnce([{ externalId: 'core-1', coreOfferingId: 'core-1' }])
      .mockResolvedValueOnce([{ id: 10, externalId: 'core-1', isPublished: false }]);
    courseOfferingFindFirst.mockResolvedValue({
      id: 10,
      externalId: 'core-1',
      coreOfferingId: 'core-1',
      isPublished: false,
    });

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.publishSynced).toBe(1);
    expect(courseOfferingUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({ isPublished: true }),
    });
    expect(courseOfferingCreate).not.toHaveBeenCalled();
  });
});

describe('importEnrolledCoursesFromCore (AI Tutor)', () => {
  const student = { id: 'student-1', role: 'STUDENT' };

  beforeEach(() => {
    vi.clearAllMocks();
    courseOfferingFindFirst.mockResolvedValue(null);
    courseOfferingCreate.mockResolvedValue({ id: 20, title: 'COSC 111 - Computing' });
    courseOfferingUpdate.mockResolvedValue({});
    courseEnrollmentUpsert.mockResolvedValue({});
    courseEnrollmentFindMany.mockResolvedValue([]);
    courseEnrollmentDeleteMany.mockResolvedValue({ count: 0 });
  });

  it('skips enrollment mirror for instructors', async () => {
    const result = await importEnrolledCoursesFromCore({ id: 'prof-1', role: 'INSTRUCTOR' }, 'session=abc');

    expect(result).toEqual({ enrolled: 0, skipped: 0, removed: 0 });
    expect(listEduAiCourses).not.toHaveBeenCalled();
  });

  it('creates local enrollment for each Core student course', async () => {
    listEduAiCourses.mockResolvedValue([
      {
        id: 'core-1',
        code: 'COSC 111',
        name: 'Computing Science',
        callerEnrollmentRole: 'STUDENT',
        isPublished: true,
      },
    ]);

    const result = await importEnrolledCoursesFromCore(student, 'session=abc');

    expect(result.enrolled).toBe(1);
    expect(courseEnrollmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: 20,
            userId: 'student-1',
          },
        },
        create: expect.objectContaining({ role: 'STUDENT' }),
      }),
    );
  });

  it('does not prune enrollments when Core returns an empty course list', async () => {
    listEduAiCourses.mockResolvedValue([]);
    courseEnrollmentFindMany.mockResolvedValue([
      {
        courseOfferingId: 30,
        courseOffering: {
          externalSource: 'EDUAI',
          externalId: 'core-old',
          coreOfferingId: 'core-old',
        },
      },
    ]);

    const result = await importEnrolledCoursesFromCore(student, 'session=abc');

    expect(result.removed).toBe(0);
    expect(courseEnrollmentDeleteMany).not.toHaveBeenCalled();
  });

  it('removes stale EDUAI student enrollments no longer in Core', async () => {
    listEduAiCourses.mockResolvedValue([
      {
        id: 'core-current',
        code: 'COSC 111',
        name: 'Computing',
        callerEnrollmentRole: 'STUDENT',
      },
    ]);
    courseEnrollmentFindMany.mockResolvedValue([
      {
        courseOfferingId: 30,
        courseOffering: {
          externalSource: 'EDUAI',
          externalId: 'core-old',
          coreOfferingId: 'core-old',
        },
      },
      {
        courseOfferingId: 31,
        courseOffering: {
          externalSource: 'EDUAI',
          externalId: 'core-current',
          coreOfferingId: 'core-current',
        },
      },
    ]);
    courseEnrollmentDeleteMany.mockResolvedValue({ count: 1 });

    const result = await importEnrolledCoursesFromCore(student, 'session=abc');

    expect(result.removed).toBe(1);
    expect(courseEnrollmentDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'student-1',
        role: 'STUDENT',
        courseOfferingId: { in: [30] },
      },
    });
  });
});

describe('userHasCoreTaEnrollment (AI Tutor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when Core reports a TA enrollment in any course', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', callerEnrollmentRole: 'STUDENT' },
      { id: 'core-2', callerEnrollmentRole: 'TA' },
    ]);

    await expect(userHasCoreTaEnrollment('session=abc')).resolves.toBe(true);
    expect(listEduAiCourses).toHaveBeenCalledWith({ cookie: 'session=abc' });
  });

  it('uses a pre-fetched course list without calling Core again', async () => {
    const prefetched = [{ id: 'core-2', callerEnrollmentRole: 'TA' }];

    await expect(userHasCoreTaEnrollment('session=abc', prefetched)).resolves.toBe(true);
    expect(listEduAiCourses).not.toHaveBeenCalled();
  });

  it('returns false when the caller is only a student or instructor', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', callerEnrollmentRole: 'STUDENT' },
      { id: 'core-2', callerEnrollmentRole: 'INSTRUCTOR' },
      { id: 'core-3', callerEnrollmentRole: null },
    ]);

    await expect(userHasCoreTaEnrollment('session=abc')).resolves.toBe(false);
  });

  it('returns false when Core returns no courses', async () => {
    listEduAiCourses.mockResolvedValue([]);

    await expect(userHasCoreTaEnrollment('session=abc')).resolves.toBe(false);
  });

  it('propagates Core client errors so /me can fall back to the platform role', async () => {
    listEduAiCourses.mockRejectedValue(new Error('Core unavailable'));

    await expect(userHasCoreTaEnrollment('session=abc')).rejects.toThrow('Core unavailable');
  });
});
