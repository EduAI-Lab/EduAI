import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseFindUnique = vi.fn();
const moduleCount = vi.fn();
const moduleFindUnique = vi.fn();
const lessonFindMany = vi.fn();
const transaction = vi.fn();
const isCourseAdmin = vi.fn();
const cloneCourseContent = vi.fn();
const cloneLessonsFromOffering = vi.fn();
const resolveCoreCourseCatalog = vi.fn();
const resolveCoreCourseById = vi.fn();
const setCoreCoursePublishState = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: { findUnique: courseFindUnique },
    module: { count: moduleCount, findUnique: moduleFindUnique },
    lesson: { findMany: lessonFindMany },
    $transaction: transaction,
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  isCourseAdmin: (...args) => isCourseAdmin(...args),
}));

vi.mock('../../src/services/courseCloning.js', () => ({
  cloneCourseContent: (...args) => cloneCourseContent(...args),
  cloneLessonsFromOffering: (...args) => cloneLessonsFromOffering(...args),
}));

vi.mock('../../src/services/courseResolver.js', () => ({
  resolveCoreCourseCatalog: (...args) => resolveCoreCourseCatalog(...args),
  resolveCoreCourseById: (...args) => resolveCoreCourseById(...args),
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  setCoreCoursePublishState: (...args) => setCoreCoursePublishState(...args),
}));

const {
  CourseMutationError,
  importCourseContentForUser,
  publishCourseForUser,
  unpublishCourseForUser,
} = await import('../../src/services/courseManagement.js');

const user = { id: 'instructor-1', role: 'INSTRUCTOR' };
const destination = { id: 20, coreOfferingId: 'core-20', instructors: [{ userId: user.id }] };

beforeEach(() => {
  vi.clearAllMocks();
  isCourseAdmin.mockResolvedValue(true);
  courseFindUnique.mockResolvedValue(destination);
  moduleCount.mockResolvedValue(1);
  moduleFindUnique.mockResolvedValue({ courseOfferingId: 20 });
  lessonFindMany.mockResolvedValue([]);
  cloneCourseContent.mockResolvedValue(undefined);
  cloneLessonsFromOffering.mockResolvedValue(undefined);
  resolveCoreCourseCatalog.mockResolvedValue({ courses: [] });
  resolveCoreCourseById.mockResolvedValue({
    course: { id: 'core-20', isPublished: true },
    coreUnavailable: false,
  });
  setCoreCoursePublishState.mockResolvedValue({ ok: true });
});

describe('course authoring service boundaries', () => {
  it('rejects an empty content import before any database write', async () => {
    await expect(
      importCourseContentForUser({ courseId: 20, body: {}, user }),
    ).rejects.toMatchObject({
      name: 'CourseMutationError',
      status: 400,
      message: 'Nothing to import',
    });
    expect(courseFindUnique).not.toHaveBeenCalled();
    expect(cloneCourseContent).not.toHaveBeenCalled();
  });

  it('authorizes and clones modules inside the service boundary', async () => {
    await importCourseContentForUser({
      courseId: 20,
      body: { sourceCourseId: 10, moduleIds: [3] },
      user,
    });

    expect(isCourseAdmin).toHaveBeenCalled();
    expect(moduleCount).toHaveBeenCalledWith({
      where: { id: { in: [3] }, courseOfferingId: 10 },
    });
    expect(cloneCourseContent).toHaveBeenCalledWith(10, 20, { moduleIds: [3] });
  });

  it('writes Core publish state and atomically cascades unpublish', async () => {
    const tx = {
      module: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 7 }]),
      },
      lesson: { updateMany: vi.fn() },
    };
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toBeUndefined();
      return callback(tx);
    });

    const result = await unpublishCourseForUser({ courseId: 20, user });

    expect(setCoreCoursePublishState).toHaveBeenCalledWith('core-20', false);
    expect(tx.module.updateMany).toHaveBeenCalledWith({
      where: { courseOfferingId: 20 },
      data: { isPublished: false },
    });
    expect(tx.lesson.updateMany).toHaveBeenCalledWith({
      where: { moduleId: { in: [7] } },
      data: { isPublished: false },
    });
    expect(result.published).toBe(false);
  });

  it('preserves a stable authorization error for publish', async () => {
    isCourseAdmin.mockResolvedValue(false);

    await expect(publishCourseForUser({ courseId: 20, user })).rejects.toBeInstanceOf(
      CourseMutationError,
    );
    expect(setCoreCoursePublishState).not.toHaveBeenCalled();
  });
});
