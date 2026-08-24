/**
 * @file Lesson breadcrumb ancestry for GET /lessons/:id/breadcrumb (#1334).
 *
 * The student/instructor lesson players used to walk module → course →
 * sibling ordinals in separate client round-trips after loading the lesson.
 * Those calls existed only for the header breadcrumb and the "3.2" order
 * chip. Serving the same payload from a dedicated endpoint keeps Core course
 * resolution and ordinal counts off the initial GET /lessons/:id path so the
 * lesson body can render first; clients fetch this after paint.
 *
 * Ordinal math matches GET /lessons/:id/context (#1207): 1-based positions
 * under `position asc, id asc`, with students counting only published
 * siblings so the label matches the tree they can navigate.
 */
import { prisma } from "../config/database.js";
import { mapCourseOffering, mapModule } from "../utils/mappers.js";
import { resolveCoreCourseById } from "./courseResolver.js";
import { AUTO_SYNC_TIMEOUT_MS } from "./enrollmentSync.js";

/** Rows that sort before `row` under canonical `position asc, id asc`. */
function sortsBefore(row) {
  return {
    OR: [{ position: { lt: row.position } }, { position: row.position, id: { lt: row.id } }],
  };
}

function sortsAfter(row) {
  return {
    OR: [{ position: { gt: row.position } }, { position: row.position, id: { gt: row.id } }],
  };
}

/**
 * Structural position of a lesson in its module/course tree.
 *
 * @param {object} lesson Prisma lesson row (needs id, position, moduleId)
 * @param {object} module Prisma module row (needs id, position, courseOfferingId)
 * @param {{ publishedOnly: boolean }} opts
 */
export async function computeLessonTreeContext(lesson, module, { publishedOnly }) {
  // Staff count across every sibling; a student counts only published ones.
  // `undefined` is Prisma's "no constraint".
  const moduleScope = {
    courseOfferingId: module.courseOfferingId,
    isPublished: publishedOnly ? true : undefined,
  };
  const lessonScope = {
    moduleId: lesson.moduleId,
    isPublished: publishedOnly ? true : undefined,
  };

  const [modulesBefore, moduleTotal, lessonsBefore, lessonTotal, prev, next] = await Promise.all([
    prisma.module.count({ where: { AND: [moduleScope, sortsBefore(module)] } }),
    prisma.module.count({ where: moduleScope }),
    prisma.lesson.count({ where: { AND: [lessonScope, sortsBefore(lesson)] } }),
    prisma.lesson.count({ where: lessonScope }),
    prisma.lesson.findFirst({
      where: { AND: [lessonScope, sortsBefore(lesson)] },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.lesson.findFirst({
      where: { AND: [lessonScope, sortsAfter(lesson)] },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);

  return {
    moduleOrdinal: modulesBefore + 1,
    lessonOrdinal: lessonsBefore + 1,
    moduleTotal,
    lessonTotal,
    prevLessonId: prev?.id ?? null,
    nextLessonId: next?.id ?? null,
  };
}

/**
 * Breadcrumb payload for GET /lessons/:id/breadcrumb.
 *
 * @param {object} lesson Prisma lesson with `module.courseOffering` included
 * @param {{ publishedOnly: boolean }} opts
 * @returns {Promise<{ breadcrumb: object, coreUnavailable: boolean }>}
 */
export async function buildLessonBreadcrumb(lesson, { publishedOnly }) {
  const { module } = lesson;
  const { courseOffering } = module;

  const [{ course: coreCourse, coreUnavailable }, context] = await Promise.all([
    resolveCoreCourseById(courseOffering.coreOfferingId, {
      signal: AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS),
    }),
    computeLessonTreeContext(lesson, module, { publishedOnly }),
  ]);

  return {
    coreUnavailable,
    breadcrumb: {
      module: mapModule(module),
      course: mapCourseOffering(courseOffering, coreCourse),
      ...context,
    },
  };
}
