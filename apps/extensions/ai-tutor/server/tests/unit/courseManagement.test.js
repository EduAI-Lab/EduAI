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
const authorizeLiveCoursePrincipal = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: { findUnique: courseFindUnique },
    module: { count: moduleCount, findUnique: moduleFindUnique },
    lesson: { findMany: lessonFindMany },
    $transaction: transaction,
  },
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

vi.mock('../../src/services/liveCoursePrincipal.js', () => ({
  authorizeLiveCoursePrincipal: (...args) => authorizeLiveCoursePrincipal(...args),
  isAllowedLiveCourseStaffPrincipal: (principal) =>
    principal?.state === 'allowed' &&
    ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'].includes(principal.kind),
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE: 'COURSE_AUTH_UNAVAILABLE',
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE: 'Course authorization unavailable',
}));

const {
  CourseMutationError,
  importCourseContentForUser,
  publishCourseForUser,
  unpublishCourseForUser,
} = await import('../../src/services/courseManagement.js');

const user = { id: 'instructor-1', role: 'INSTRUCTOR' };
const destination = { id: 20, coreOfferingId: 'core-20', instructors: [{ userId: user.id }] };
const importTx = { marker: 'import-transaction' };

beforeEach(() => {
  vi.clearAllMocks();
  isCourseAdmin.mockResolvedValue(true);
  authorizeLiveCoursePrincipal.mockResolvedValue({
    state: 'allowed',
    kind: 'INSTRUCTOR',
    role: 'INSTRUCTOR',
  });
  courseFindUnique.mockResolvedValue(destination);
  moduleCount.mockResolvedValue(1);
  moduleFindUnique.mockResolvedValue({ courseOfferingId: 20 });
  lessonFindMany.mockResolvedValue([]);
  transaction.mockImplementation(async (callback) => callback(importTx));
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

  it('rejects a mixed-validity id array instead of importing its valid subset', async () => {
    await expect(
      importCourseContentForUser({
        courseId: 20,
        body: { sourceCourseId: 10, moduleIds: [3, 'not-an-id'] },
        user,
      }),
    ).rejects.toMatchObject({
      name: 'CourseMutationError',
      status: 400,
      message: 'Invalid import request',
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

    expect(authorizeLiveCoursePrincipal).toHaveBeenCalled();
    expect(moduleCount).toHaveBeenCalledWith({
      where: { id: { in: [3] }, courseOfferingId: 10 },
    });
    expect(cloneCourseContent).toHaveBeenCalledWith(10, 20, { moduleIds: [3] }, importTx);
  });

  it('maps a live Core outage to 503 before reading source content or writing', async () => {
    authorizeLiveCoursePrincipal.mockResolvedValueOnce({
      state: 'unavailable',
      kind: null,
      role: null,
    });

    await expect(
      importCourseContentForUser({
        courseId: 20,
        body: { sourceCourseId: 10, moduleIds: [3] },
        user,
      }),
    ).rejects.toMatchObject({ status: 503, code: 'COURSE_AUTH_UNAVAILABLE' });

    expect(moduleCount).not.toHaveBeenCalled();
    expect(cloneCourseContent).not.toHaveBeenCalled();
    expect(cloneLessonsFromOffering).not.toHaveBeenCalled();
  });

  it('authorizes every source before cloning any selected content', async () => {
    const sourceModuleCourse = {
      id: 10,
      coreOfferingId: 'core-10',
      instructors: [{ userId: user.id }],
    };
    const sourceLessonCourse = {
      id: 11,
      coreOfferingId: 'core-11',
      instructors: [{ userId: user.id }],
    };
    courseFindUnique
      .mockResolvedValueOnce(destination)
      .mockResolvedValueOnce(sourceModuleCourse)
      .mockResolvedValueOnce(sourceLessonCourse);
    authorizeLiveCoursePrincipal
      .mockResolvedValueOnce({ state: 'allowed', kind: 'INSTRUCTOR', role: 'INSTRUCTOR' })
      .mockResolvedValueOnce({ state: 'allowed', kind: 'INSTRUCTOR', role: 'INSTRUCTOR' })
      .mockResolvedValueOnce({ state: 'denied', kind: null, role: 'STUDENT' });
    lessonFindMany.mockResolvedValue([
      { id: 4, module: { courseOfferingId: sourceLessonCourse.id } },
    ]);

    await expect(
      importCourseContentForUser({
        courseId: destination.id,
        body: {
          sourceCourseId: sourceModuleCourse.id,
          moduleIds: [3],
          lessonIds: [4],
          targetModuleId: 30,
        },
        user,
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Not authorized for lesson source course' });

    expect(cloneCourseContent).not.toHaveBeenCalled();
    expect(cloneLessonsFromOffering).not.toHaveBeenCalled();
    expect(moduleCount).not.toHaveBeenCalled();
  });

  it('runs mixed module and lesson imports in one transaction', async () => {
    const sourceCourse = {
      id: 10,
      coreOfferingId: 'core-10',
      instructors: [{ userId: user.id }],
    };
    const tx = { marker: 'shared-import-transaction' };
    courseFindUnique.mockResolvedValueOnce(destination).mockResolvedValueOnce(sourceCourse);
    lessonFindMany.mockResolvedValue([{ id: 4, module: { courseOfferingId: sourceCourse.id } }]);
    transaction.mockImplementation(async (callback) => callback(tx));
    cloneLessonsFromOffering.mockRejectedValueOnce(new Error('lesson clone failed'));

    await expect(
      importCourseContentForUser({
        courseId: destination.id,
        body: {
          sourceCourseId: sourceCourse.id,
          moduleIds: [3],
          lessonIds: [4],
          targetModuleId: 30,
        },
        user,
      }),
    ).rejects.toThrow('lesson clone failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(cloneCourseContent).toHaveBeenCalledWith(
      sourceCourse.id,
      destination.id,
      { moduleIds: [3] },
      tx,
    );
    expect(cloneLessonsFromOffering).toHaveBeenCalledWith([4], 30, tx);
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

    const result = await unpublishCourseForUser({
      courseId: 20,
      user,
      cookie: 'session=user-session',
    });

    expect(setCoreCoursePublishState).toHaveBeenCalledWith('core-20', false, {
      cookie: 'session=user-session',
    });
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
    authorizeLiveCoursePrincipal.mockResolvedValue({ state: 'denied', kind: null, role: null });

    await expect(publishCourseForUser({ courseId: 20, user })).rejects.toBeInstanceOf(
      CourseMutationError,
    );
    expect(setCoreCoursePublishState).not.toHaveBeenCalled();
  });
});
