/**
 * Unit tests for importTaughtCoursesFromCore (QM backend).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseFindAll = vi.fn();
const courseFindOne = vi.fn();
const courseCreate = vi.fn();
const courseUpdate = vi.fn();
const topicsFindAll = vi.fn();
const topicsCreate = vi.fn();
const assessmentsFindOne = vi.fn();
const createAssessment = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Course: {
    findAll: courseFindAll,
    findOne: courseFindOne,
    create: courseCreate,
  },
  Topics: {
    findAll: topicsFindAll,
    create: topicsCreate,
  },
  Assessments: {
    findOne: assessmentsFindOne,
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
    courseFindAll.mockResolvedValue([]);
    courseFindOne.mockResolvedValue(null);
    courseCreate.mockImplementation(async (data) => ({ id: 99, ...data, update: courseUpdate }));
    topicsFindAll.mockResolvedValue([{ id: 1, name: 'Topic A' }]);
    topicsCreate.mockResolvedValue({});
    assessmentsFindOne.mockResolvedValue(null);
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
    listCoursesFromCore.mockResolvedValue({
      courses: [
        {
          id: 'core-1',
          code: 'COSC 111',
          name: 'Computing Science',
          callerEnrollmentRole: 'INSTRUCTOR',
        },
      ],
    });

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(1);
    // `name`/`code` are Core-owned and never written locally (#1072 §4 step 10)
    // — the anchor is just userId + coreCourseId.
    expect(courseCreate).toHaveBeenCalledWith({
      userId: 'u1',
      coreCourseId: 'core-1',
    });
    expect(createAssessment).toHaveBeenCalled();
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalled();
  });

  it('provisions (not duplicates) a Core course already linked to a local anchor the caller owns', async () => {
    listCoursesFromCore.mockResolvedValue({
      courses: [
        {
          id: 'core-2',
          code: 'COSC 121',
          name: 'Programming II',
          callerEnrollmentRole: 'INSTRUCTOR',
        },
      ],
    });
    const localCourse = {
      id: 5,
      userId: 'u1',
      coreCourseId: 'core-2',
      update: courseUpdate,
    };
    courseFindAll.mockResolvedValue([localCourse]);

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
    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: 'core-3', callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    const adminAnchor = {
      id: 7,
      userId: 'admin-1',
      coreCourseId: 'core-3',
      update: courseUpdate,
    };
    courseFindAll.mockResolvedValue([adminAnchor]);
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [{ studentId: 'u1', role: 'INSTRUCTOR', isActive: true }],
    });

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.synced).toBe(1);
    expect(courseCreate).not.toHaveBeenCalled();
    expect(courseUpdate).toHaveBeenCalledWith({ userId: 'u1' });
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(adminAnchor, 'session=abc');
    expect(createAssessment).toHaveBeenCalled();
  });

  it('leaves ownership alone when the current owner is a teaching co-instructor', async () => {
    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: 'core-4', callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    const coInstructorAnchor = {
      id: 8,
      userId: 'u2',
      coreCourseId: 'core-4',
      update: courseUpdate,
    };
    courseFindAll.mockResolvedValue([coInstructorAnchor]);
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
    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: 'core-5', callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    const anchor = { id: 9, userId: 'admin-1', coreCourseId: 'core-5', update: courseUpdate };
    courseFindAll.mockResolvedValue([anchor]);
    getCourseEnrollmentsFromCore.mockRejectedValue(new Error('Core unreachable'));

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(courseUpdate).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
  });

  it('adopts the existing anchor when Course.create loses the unique-constraint race', async () => {
    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: 'core-6', callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    courseFindAll.mockResolvedValue([]);
    courseCreate.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const racedAnchor = { id: 10, userId: 'u1', coreCourseId: 'core-6', update: courseUpdate };
    courseFindOne.mockImplementation(async ({ where }) =>
      where?.coreCourseId === 'core-6' ? racedAnchor : null,
    );

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.synced).toBe(1);
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalledWith(racedAnchor, 'session=abc');
  });

  it('never creates a second Practice Exam for an already-provisioned course', async () => {
    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: 'core-7', callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    const anchor = { id: 11, userId: 'u1', coreCourseId: 'core-7', update: courseUpdate };
    courseFindAll.mockResolvedValue([anchor]);
    assessmentsFindOne.mockResolvedValue({ id: 42, name: 'Practice Exam' });

    await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(createAssessment).not.toHaveBeenCalled();
  });
});
