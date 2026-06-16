/**
 * Unit tests for importTaughtCoursesFromCore (QM backend).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseFindAll = vi.fn();
const courseCreate = vi.fn();
const courseUpdate = vi.fn();
const topicsFindAll = vi.fn();
const topicsCreate = vi.fn();
const createAssessment = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Course: {
    findAll: courseFindAll,
    create: courseCreate,
  },
  Topics: {
    findAll: topicsFindAll,
    create: topicsCreate,
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  listCoursesFromCore: vi.fn(),
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

const { listCoursesFromCore } = await import('../../src/services/coreApiService.js');
const { syncTopicsFromCoreForCourse } = await import('../../src/services/topicSyncService.js');
const { importTaughtCoursesFromCore } = await import('../../src/services/importTaughtCoursesService.js');

describe('importTaughtCoursesFromCore (QM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    courseFindAll.mockResolvedValue([]);
    courseCreate.mockImplementation(async (data) => ({ id: 99, ...data, update: courseUpdate }));
    topicsFindAll.mockResolvedValue([{ id: 1, name: 'Topic A' }]);
    topicsCreate.mockResolvedValue({});
    createAssessment.mockResolvedValue({});
    syncTopicsFromCoreForCourse.mockResolvedValue(1);
  });

  it('skips auto-import for non-instructor roles', async () => {
    const result = await importTaughtCoursesFromCore('u1', 'STUDENT', 'session=abc');

    expect(result).toEqual({ imported: 0, linked: 0, skipped: 0 });
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
    expect(courseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        coreCourseId: 'core-1',
        code: 'COSC 111',
      }),
    );
    expect(createAssessment).toHaveBeenCalled();
    expect(syncTopicsFromCoreForCourse).toHaveBeenCalled();
  });

  it('links an existing local course by code instead of creating a duplicate', async () => {
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
      code: 'COSC 121',
      coreCourseId: null,
      update: courseUpdate,
    };
    courseFindAll.mockResolvedValue([localCourse]);

    const result = await importTaughtCoursesFromCore('u1', 'INSTRUCTOR', 'session=abc');

    expect(result.linked).toBe(1);
    expect(result.imported).toBe(0);
    expect(courseUpdate).toHaveBeenCalled();
    expect(courseCreate).not.toHaveBeenCalled();
  });
});
