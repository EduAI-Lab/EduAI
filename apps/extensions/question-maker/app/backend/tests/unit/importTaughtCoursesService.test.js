/**
 * Unit tests for importTaughtCoursesFromCore (QM backend).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@eduai/question-maker-prisma-client';

const courseFindMany = vi.fn();
const courseFindUnique = vi.fn();
const courseCreate = vi.fn();
const courseUpdate = vi.fn();
const topicsFindMany = vi.fn();
const topicsCreate = vi.fn();
const assessmentsFindFirst = vi.fn();
const createAssessment = vi.fn();

// ensurePracticeExam serializes via a transaction-scoped advisory lock; in
// unit tests the transaction is a passthrough and the lock query a no-op.
const tx = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  assessments: { findFirst: assessmentsFindFirst },
};

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(async (fn) => fn(tx)),
    course: {
      findMany: courseFindMany,
      findUnique: courseFindUnique,
      create: courseCreate,
      update: courseUpdate,
    },
    topics: {
      findMany: topicsFindMany,
      create: topicsCreate,
    },
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  listCoursesFromCore: vi.fn(),
  getCourseEnrollmentsFromCore: vi.fn(),
}));

vi.mock('../../src/services/topicSyncService.js', () => ({
  syncTopicsFromCoreForCourse: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../src/services/assessmentService.js', () => ({
  createAssessment,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { listCoursesFromCore, getCourseEnrollmentsFromCore } = await import(
  '../../src/services/coreApiService.js'
);
const { syncTopicsFromCoreForCourse } = await import('../../src/services/topicSyncService.js');
const { importTaughtCoursesFromCore } = await import('../../src/services/importTaughtCoursesService.js');

describe('importTaughtCoursesFromCore (QM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    courseFindMany.mockResolvedValue([]);
    courseFindUnique.mockResolvedValue(null);
    courseCreate.mockImplementation(async ({ data }) => ({ id: 99, ...data }));
    topicsFindMany.mockResolvedValue([{ id: 1, name: 'Topic A' }]);
    topicsCreate.mockResolvedValue({});
    assessmentsFindFirst.mockResolvedValue(null);
    createAssessment.mockResolvedValue({});
    syncTopicsFromCoreForCourse.mockResolvedValue(1);
    getCourseEnrollmentsFromCore.mockResolvedValue({ enrollments: [] });
  });

  it('skips auto-import for non-instructor roles', async () => {
    const result = await importTaughtCoursesFromCore('u1', 'STUDENT', 'session=abc');

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(listCoursesFromCore).not.toHaveBeenCalled();
  });

  it('creates local courses for unlinked Core courses', async () => {
    listCoursesFromCore.mockResolvedValue([
        {
          id: 'core-1',
          code: 'COSC 111',
          name: 'Computing Science',
          callerEnrollmentRole: 'INSTRUCTOR',
        },
      ]);

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(1);
    // `name`/`code` are Core-owned and never written locally (#1072 §4 step 10)
    // — the anchor is just userId + coreCourseId.
    expect(courseCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', coreCourseId: 'core-1' },
    });
    expect(createAssessment).toHaveBeenCalled();
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalled();
  });

  it('provisions (not duplicates) a Core course already linked to a local anchor the caller owns', async () => {
    listCoursesFromCore.mockResolvedValue([
        {
          id: 'core-2',
          code: 'COSC 121',
          name: 'Programming II',
          callerEnrollmentRole: 'INSTRUCTOR',
        },
      ]);
    const localCourse = { id: 5, userId: 'u1', coreCourseId: 'core-2' };
    courseFindMany.mockResolvedValue([localCourse]);

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.synced).toBe(1);
    expect(courseCreate).not.toHaveBeenCalled();
    expect(courseUpdate).not.toHaveBeenCalled();
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(localCourse, 'session=abc');
  });

  it('adopts and claims an anchor materialized by a non-teaching owner (ADMIN catalog visit)', async () => {
    // Regression: an ADMIN opening the course list materializes catalog
    // anchors under their own userId (#1074). The instructor's import must
    // find that anchor by coreCourseId, claim ownership (the owner is not on
    // the Core roster as a teacher), and run topic sync + Practice Exam —
    // previously it hit the unique core_course_id constraint and skipped all
    // of that, and Core-down access fell back to the wrong owner.
    listCoursesFromCore.mockResolvedValue([{ id: 'core-3', callerEnrollmentRole: 'INSTRUCTOR' }]);
    const adminAnchor = { id: 7, userId: 'admin-1', coreCourseId: 'core-3' };
    courseFindMany.mockResolvedValue([adminAnchor]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [{ studentId: 'u1', role: 'INSTRUCTOR', isActive: true }],
    });

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.synced).toBe(1);
    expect(courseCreate).not.toHaveBeenCalled();
    expect(courseUpdate).toHaveBeenCalledWith({ where: { id: adminAnchor.id }, data: { userId: 'u1' } });
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(adminAnchor, 'session=abc');
    expect(createAssessment).toHaveBeenCalled();
  });

  it('leaves ownership alone when the current owner is a teaching co-instructor', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-4', callerEnrollmentRole: 'INSTRUCTOR' }]);
    const coInstructorAnchor = { id: 8, userId: 'u2', coreCourseId: 'core-4' };
    courseFindMany.mockResolvedValue([coInstructorAnchor]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [
        { studentId: 'u2', role: 'INSTRUCTOR', isActive: true },
        { studentId: 'u1', role: 'INSTRUCTOR', isActive: true },
      ],
    });

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(courseUpdate).not.toHaveBeenCalled();
    // Still fully provisioned for the caller.
    expect(result.synced).toBe(1);
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(coInstructorAnchor, 'session=abc');
  });

  it('keeps ownership when the roster check fails (conservative)', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-5', callerEnrollmentRole: 'INSTRUCTOR' }]);
    const anchor = { id: 9, userId: 'admin-1', coreCourseId: 'core-5' };
    courseFindMany.mockResolvedValue([anchor]);
    getCourseEnrollmentsFromCore.mockRejectedValue(new Error('Core unreachable'));

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(courseUpdate).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
  });

  it('adopts the existing anchor when Course.create loses the unique-constraint race', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-6', callerEnrollmentRole: 'INSTRUCTOR' }]);
    courseFindMany.mockResolvedValue([]);
    courseCreate.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const racedAnchor = { id: 10, userId: 'u1', coreCourseId: 'core-6' };
    courseFindUnique.mockImplementation(async ({ where }) =>
      where?.coreCourseId === 'core-6' ? racedAnchor : null,
    );

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.synced).toBe(1);
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(racedAnchor, 'session=abc');
  });

  it('never creates a second Practice Exam for an already-provisioned course', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-7', callerEnrollmentRole: 'INSTRUCTOR' }]);
    const anchor = { id: 11, userId: 'u1', coreCourseId: 'core-7' };
    courseFindMany.mockResolvedValue([anchor]);
    assessmentsFindFirst.mockResolvedValue({ id: 42, name: 'Practice Exam' });

    await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(createAssessment).not.toHaveBeenCalled();
  });

  // Two co-instructors can provision the same anchor at once: both read an empty
  // topic list, and the loser trips the unique (course_id, name) index. Losing
  // that race must not abort the rest of the import.
  it('swallows a duplicate General topic when the racing writer already created it', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-8', callerEnrollmentRole: 'INSTRUCTOR' }]);
    courseFindMany.mockResolvedValue([{ id: 12, userId: 'u1', coreCourseId: 'core-8' }]);
    topicsFindMany.mockResolvedValue([]);
    topicsCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['course_id', 'name'] },
      }),
    );

    await expect(
      importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc'),
    ).resolves.toMatchObject({ synced: 1 });

    // Provisioning continued past the duplicate.
    expect(createAssessment).toHaveBeenCalled();
  });

  it('does not swallow a topic create failure that is not a lost race', async () => {
    listCoursesFromCore.mockResolvedValue([{ id: 'core-9', callerEnrollmentRole: 'INSTRUCTOR' }]);
    courseFindMany.mockResolvedValue([{ id: 13, userId: 'u1', coreCourseId: 'core-9' }]);
    topicsFindMany.mockResolvedValue([]);
    // Not a P2002, so the failure was real: provisioning must abort for this
    // course rather than continuing as if the topic existed. The per-course
    // handler contains the throw, so the run still returns a tally.
    topicsCreate.mockRejectedValue(new Error('connection terminated'));

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result).toMatchObject({ imported: 0, synced: 0 });
    expect(createAssessment).not.toHaveBeenCalled();
  });
});
