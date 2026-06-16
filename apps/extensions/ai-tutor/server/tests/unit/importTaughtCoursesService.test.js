/**
 * Unit tests for importTaughtCoursesFromCore (AI Tutor server).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseOfferingFindFirst = vi.fn();
const courseOfferingFindMany = vi.fn();
const courseOfferingCreate = vi.fn();
const courseInstructorCreate = vi.fn();
const transaction = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: {
      findFirst: courseOfferingFindFirst,
      findMany: courseOfferingFindMany,
      create: courseOfferingCreate,
    },
    courseInstructor: {
      create: courseInstructorCreate,
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
const { importTaughtCoursesFromCore } = await import('../../src/services/importTaughtCoursesService.js');

describe('importTaughtCoursesFromCore (AI Tutor)', () => {
  const instructor = { id: 'prof-1', role: 'INSTRUCTOR' };

  beforeEach(() => {
    vi.clearAllMocks();
    courseOfferingFindMany.mockResolvedValue([]);
    courseOfferingFindFirst.mockResolvedValue(null);
    transaction.mockImplementation(async (fn) =>
      fn({
        courseOffering: { create: courseOfferingCreate },
        courseInstructor: { create: courseInstructorCreate },
      }),
    );
    courseOfferingCreate.mockResolvedValue({ id: 10, title: 'COSC 111 - Computing' });
    courseInstructorCreate.mockResolvedValue({});
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
});
