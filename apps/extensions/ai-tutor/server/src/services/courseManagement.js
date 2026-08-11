/**
 * Course authoring mutations.
 *
 * Route modules should translate HTTP input/output only. This service keeps
 * course-scoped authorization, content-import validation, Core publish writes,
 * and the local unpublish cascade together so those invariants cannot drift
 * between endpoints.
 */

import { prisma } from '../config/database.js';
import { cloneCourseContent, cloneLessonsFromOffering } from './courseCloning.js';
import { resolveCoreCourseById } from './courseResolver.js';
import { setCoreCoursePublishState } from './eduaiClient.js';
import {
  authorizeLiveCoursePrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from './liveCoursePrincipal.js';

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

async function requireLiveCourseAdmin(course, user, message = 'Not authorized for this course') {
  const principal = await authorizeLiveCoursePrincipal(course, user);
  if (principal.state === 'unavailable') {
    throw new CourseMutationError(
      LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
      503,
      LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
    );
  }
  if (
    principal.state !== 'allowed' ||
    (!['ADMIN', 'UNIT_ADMIN'].includes(principal.kind) &&
      !(
        principal.kind === 'INSTRUCTOR' &&
        course.instructors?.some((entry) => entry.userId === user.id)
      ))
  ) {
    throw new CourseMutationError(message, 403);
  }
  return principal;
}

/** Clone selected modules/lessons after validating every course boundary. */
export async function importCourseContentForUser({ courseId, body, user }) {
  const { normalizedModuleIds, normalizedLessonIds, numericTargetModuleId, numericSourceCourseId } =
    normalizeImportRequest(body);

  const destination = await loadCourseForAdmin(courseId);
  await requireLiveCourseAdmin(destination, user);

  // Validate request shape and resolve only relationship metadata first. No
  // source authored content is read until every distinct source course has
  // passed the live Core principal check below.
  if (normalizedModuleIds.length > 0 && numericSourceCourseId === null) {
    throw new CourseMutationError('sourceCourseId required when importing modules');
  }
  let lessonSources = null;
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

    // First resolve only the parent course ids. This metadata lookup lets us
    // authorize every exact source course before loading lesson content.
    lessonSources = await prisma.lesson.findMany({
      where: { id: { in: normalizedLessonIds } },
      select: { id: true, module: { select: { courseOfferingId: true } } },
    });
    if (lessonSources.length !== normalizedLessonIds.length) {
      throw new CourseMutationError('One or more lessons were not found');
    }
  }

  const sourceCourseIds = new Set(
    [
      normalizedModuleIds.length > 0 ? numericSourceCourseId : null,
      ...(lessonSources ?? []).map((lesson) => lesson.module.courseOfferingId),
    ].filter((id) => id !== null),
  );
  for (const sourceCourseId of sourceCourseIds) {
    const sourceCourse = await loadCourseForAdmin(
      sourceCourseId,
      normalizedModuleIds.length > 0 && sourceCourseId === numericSourceCourseId
        ? 'Not authorized for source course'
        : 'Not authorized for lesson source course',
      403,
    );
    await requireLiveCourseAdmin(
      sourceCourse,
      user,
      normalizedModuleIds.length > 0 && sourceCourseId === numericSourceCourseId
        ? 'Not authorized for source course'
        : 'Not authorized for lesson source course',
    );
  }

  let moduleImport = null;
  let lessonImport = null;
  if (normalizedModuleIds.length > 0) {
    const moduleCount = await prisma.module.count({
      where: {
        id: { in: normalizedModuleIds },
        courseOfferingId: numericSourceCourseId,
      },
    });
    if (moduleCount !== normalizedModuleIds.length) {
      throw new CourseMutationError('One or more modules do not belong to source course');
    }
    moduleImport = { sourceCourseId: numericSourceCourseId, moduleIds: normalizedModuleIds };
  }
  if (normalizedLessonIds.length > 0) {
    // Only after every source course passes live authorization do we load the
    // authored lesson tree. All request validation is complete before either
    // clone transaction starts, so a denied source cannot leave partial writes.
    const lessons = await prisma.lesson.findMany({
      where: { id: { in: normalizedLessonIds } },
      include: { module: { select: { courseOfferingId: true } } },
    });
    if (lessons.length !== normalizedLessonIds.length) {
      throw new CourseMutationError('One or more lessons were not found');
    }
    lessonImport = { lessonIds: normalizedLessonIds, targetModuleId: numericTargetModuleId };
  }

  if (moduleImport) {
    await cloneCourseContent(moduleImport.sourceCourseId, courseId, {
      moduleIds: moduleImport.moduleIds,
    });
  }
  if (lessonImport) {
    await cloneLessonsFromOffering(lessonImport.lessonIds, lessonImport.targetModuleId);
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
  await requireLiveCourseAdmin(course, user);

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
