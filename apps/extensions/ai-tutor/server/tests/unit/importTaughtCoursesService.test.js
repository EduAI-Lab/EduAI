/**
 * Unit tests for importTaughtCoursesFromCore (AI Tutor server).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseOfferingFindFirst = vi.fn();
const courseOfferingFindMany = vi.fn();
const courseOfferingCreate = vi.fn();
const courseOfferingCreateMany = vi.fn();
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
      createMany: courseOfferingCreateMany,
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
  ensureOfferingAnchors,
  importEnrolledCoursesFromCore,
  importTaughtCoursesFromCore,
  userHasCoreTaEnrollment,
  coreCoursesIncludeTaEnrollment,
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
    courseOfferingCreate.mockResolvedValue({ id: 10, coreOfferingId: 'core-1' });
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

  it('imports Core courses not yet present locally as anchor-only rows', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', code: 'COSC 111', name: 'Computing Science', callerEnrollmentRole: 'INSTRUCTOR' },
    ]);

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.imported).toBe(1);
    expect(courseOfferingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { coreOfferingId: 'core-1' },
      }),
    );
  });

  it('skips courses already imported by the instructor', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', code: 'COSC 111', name: 'Computing Science', callerEnrollmentRole: 'INSTRUCTOR' },
    ]);
    courseOfferingFindMany.mockResolvedValue([{ coreOfferingId: 'core-1' }]);

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(courseOfferingCreate).not.toHaveBeenCalled();
  });

  it('does not reconcile Core field changes on an already-linked course (#1073 — reconcile removed, fields are read-through)', async () => {
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
      .mockResolvedValueOnce([{ coreOfferingId: 'core-1' }])
      .mockResolvedValueOnce([{ id: 10, coreOfferingId: 'core-1', isPublished: false }]);

    const result = await importTaughtCoursesFromCore(instructor, 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(courseOfferingCreate).not.toHaveBeenCalled();
    expect(courseOfferingUpdate).not.toHaveBeenCalled();
  });
});

describe('ensureOfferingAnchors (AI Tutor, #1072 step 3 / #1074 admin create-on-open)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when every id already has a local anchor', async () => {
    courseOfferingFindMany.mockResolvedValue([{ coreOfferingId: 'core-1' }, { coreOfferingId: 'core-2' }]);

    await ensureOfferingAnchors(['core-1', 'core-2']);

    expect(courseOfferingCreateMany).not.toHaveBeenCalled();
  });

  it('batch-creates anchors only for ids missing a local row — one read, one insert, never per-course', async () => {
    courseOfferingFindMany.mockResolvedValue([{ coreOfferingId: 'core-1' }]);

    await ensureOfferingAnchors(['core-1', 'core-2', 'core-3']);

    expect(courseOfferingFindMany).toHaveBeenCalledTimes(1);
    expect(courseOfferingCreateMany).toHaveBeenCalledTimes(1);
    expect(courseOfferingCreateMany).toHaveBeenCalledWith({
      data: [
        { coreOfferingId: 'core-2' },
        { coreOfferingId: 'core-3' },
      ],
      skipDuplicates: true,
    });
  });

  it('no-ops on an empty or all-falsy id list without touching the database', async () => {
    await ensureOfferingAnchors([]);
    await ensureOfferingAnchors([null, undefined, '']);

    expect(courseOfferingFindMany).not.toHaveBeenCalled();
    expect(courseOfferingCreateMany).not.toHaveBeenCalled();
  });
});

describe('importEnrolledCoursesFromCore (AI Tutor)', () => {
  const student = { id: 'student-1', role: 'STUDENT' };

  beforeEach(() => {
    vi.clearAllMocks();
    courseOfferingFindFirst.mockResolvedValue(null);
    courseOfferingCreate.mockResolvedValue({ id: 20, coreOfferingId: 'core-1' });
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
          coreOfferingId: 'core-old',
        },
      },
      {
        courseOfferingId: 31,
        courseOffering: {
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

describe('coreCoursesIncludeTaEnrollment (AI Tutor)', () => {
  it('returns false for null', () => {
    expect(coreCoursesIncludeTaEnrollment(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(coreCoursesIncludeTaEnrollment(undefined)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(coreCoursesIncludeTaEnrollment([])).toBe(false);
  });

  it('handles null entries in array', () => {
    expect(coreCoursesIncludeTaEnrollment([null, { callerEnrollmentRole: 'TA' }])).toBe(true);
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
