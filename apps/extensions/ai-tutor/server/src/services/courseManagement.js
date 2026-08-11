/**
 * Course authoring mutations.
 *
 * Route modules should translate HTTP input/output only. This service keeps
 * course-scoped authorization, content-import validation, Core publish writes,
 * and the local unpublish cascade together so those invariants cannot drift
 * between endpoints.
 */

import { prisma } from '../config/database.js';
import { isCourseAdmin } from '../middleware/auth.js';
import { cloneCourseContent, cloneLessonsFromOffering } from './courseCloning.js';
import { resolveCoreCourseById, resolveCoreCourseCatalog } from './courseResolver.js';
import { setCoreCoursePublishState } from './eduaiClient.js';

export class CourseMutationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'CourseMutationError';
    this.status = status;
    if (code) this.code = code;
  }
}

const COURSE_INSTRUCTORS = { instructors: { select: { userId: true } } };

function normalizeImportRequest(body = {}) {
  const { sourceCourseId, moduleIds, lessonIds, targetModuleId } = body;
  const normalizedModuleIds = Array.isArray(moduleIds)
    ? moduleIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  const normalizedLessonIds = Array.isArray(lessonIds)
    ? lessonIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  const numericTargetModuleId =
    typeof targetModuleId === 'number' || typeof targetModuleId === 'string'
      ? Number(targetModuleId)
      : null;
  const numericSourceCourseId =
    typeof sourceCourseId === 'number' || typeof sourceCourseId === 'string'
      ? Number(sourceCourseId)
      : null;

  if (numericSourceCourseId !== null && !Number.isFinite(numericSourceCourseId)) {
    throw new CourseMutationError('Invalid sourceCourseId');
  }
  if (normalizedModuleIds.length === 0 && normalizedLessonIds.length === 0) {
    throw new CourseMutationError('Nothing to import');
  }
  return {
    normalizedModuleIds,
    normalizedLessonIds,
    numericTargetModuleId,
    numericSourceCourseId,
  };
}

async function loadCourseForAdmin(
  courseId,
  missingMessage = 'Course not found',
  missingStatus = 404,
) {
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: COURSE_INSTRUCTORS,
  });
  if (!course) throw new CourseMutationError(missingMessage, missingStatus);
  return course;
}

/** Clone selected modules/lessons after validating every course boundary. */
export async function importCourseContentForUser({ courseId, body, user }) {
  const { normalizedModuleIds, normalizedLessonIds, numericTargetModuleId, numericSourceCourseId } =
    normalizeImportRequest(body);

  // UNIT_ADMIN department checks resolve from one Core catalog reused for every
  // source/destination course. Other roles retain the existing lazy path.
  let catalogById = null;
  if (user.role === 'UNIT_ADMIN') {
    const { courses: catalogCourses } = await resolveCoreCourseCatalog();
    catalogById = new Map(catalogCourses.map((course) => [course.id, course]));
  }
  const resolveFromCatalog = (row) =>
    catalogById ? (catalogById.get(row?.coreOfferingId) ?? null) : undefined;

  const destination = await loadCourseForAdmin(courseId);
  if (!(await isCourseAdmin(user, destination, resolveFromCatalog(destination)))) {
    throw new CourseMutationError('Not authorized for this course', 403);
  }

  if (normalizedModuleIds.length > 0) {
    if (numericSourceCourseId === null) {
      throw new CourseMutationError('sourceCourseId required when importing modules');
    }
    const sourceCourse = await loadCourseForAdmin(
      numericSourceCourseId,
      'Not authorized for source course',
      403,
    );
    if (!(await isCourseAdmin(user, sourceCourse, resolveFromCatalog(sourceCourse)))) {
      throw new CourseMutationError('Not authorized for source course', 403);
    }
    const moduleCount = await prisma.module.count({
      where: {
        id: { in: normalizedModuleIds },
        courseOfferingId: numericSourceCourseId,
      },
    });
    if (moduleCount !== normalizedModuleIds.length) {
      throw new CourseMutationError('One or more modules do not belong to source course');
    }
    await cloneCourseContent(numericSourceCourseId, courseId, {
      moduleIds: normalizedModuleIds,
    });
  }

  if (normalizedLessonIds.length > 0) {
    if (numericTargetModuleId === null || !Number.isFinite(numericTargetModuleId)) {
      throw new CourseMutationError('targetModuleId required when importing lessons');
    }
    const targetModule = await prisma.module.findUnique({
      where: { id: numericTargetModuleId },
      select: { courseOfferingId: true },
    });
    if (!targetModule || targetModule.courseOfferingId !== courseId) {
      throw new CourseMutationError('targetModuleId does not belong to destination course');
    }

    const lessons = await prisma.lesson.findMany({
      where: { id: { in: normalizedLessonIds } },
      include: { module: { select: { courseOfferingId: true } } },
    });
    if (lessons.length !== normalizedLessonIds.length) {
      throw new CourseMutationError('One or more lessons were not found');
    }

    const sourceCourseIds = new Set(lessons.map((lesson) => lesson.module.courseOfferingId));
    for (const sourceCourseId of sourceCourseIds) {
      const sourceCourse = await loadCourseForAdmin(
        sourceCourseId,
        'Not authorized for lesson source course',
        403,
      );
      if (!(await isCourseAdmin(user, sourceCourse, resolveFromCatalog(sourceCourse)))) {
        throw new CourseMutationError('Not authorized for lesson source course', 403);
      }
    }
    await cloneLessonsFromOffering(normalizedLessonIds, numericTargetModuleId);
  }

  return prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { position: 'asc' },
        include: {
          lessons: {
            orderBy: { position: 'asc' },
            include: { activities: { orderBy: { position: 'asc' } } },
          },
        },
      },
    },
  });
}

async function resolvePublishWrite(courseId, user, published, cookie) {
  const course = await loadCourseForAdmin(courseId);
  if (!(await isCourseAdmin(user, course))) {
    throw new CourseMutationError('Not authorized for this course', 403);
  }

  if (course.coreOfferingId) {
    await setCoreCoursePublishState(course.coreOfferingId, published, { cookie });
  }
  const resolved = await resolveCoreCourseById(course.coreOfferingId);
  return { course, resolved, published };
}

/** Publish through Core without cascading child content. */
export async function publishCourseForUser({ courseId, user, cookie }) {
  return resolvePublishWrite(courseId, user, true, cookie);
}

/** Unpublish through Core and atomically hide every local child module/lesson. */
export async function unpublishCourseForUser({ courseId, user, cookie }) {
  const result = await resolvePublishWrite(courseId, user, false, cookie);
  await prisma.$transaction(async (tx) => {
    await tx.module.updateMany({
      where: { courseOfferingId: courseId },
      data: { isPublished: false },
    });
    const modules = await tx.module.findMany({
      where: { courseOfferingId: courseId },
      select: { id: true },
    });
    const moduleIds = modules.map((module) => module.id);
    if (moduleIds.length > 0) {
      await tx.lesson.updateMany({
        where: { moduleId: { in: moduleIds } },
        data: { isPublished: false },
      });
    }
  });
  return result;
}
