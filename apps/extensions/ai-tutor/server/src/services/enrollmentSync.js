import { prisma } from '../config/database.js';
import { listEduAiCourseEnrollmentsServiceKey } from './eduaiClient.js';

/**
 * Sync active enrollments from Core into the local CourseEnrollment table.
 *
 * - Creates rows for users active in Core but missing locally.
 * - Deletes rows for users no longer active in Core.
 * - No-ops if Core returns an empty active list (guards against data loss
 *   from transient misconfiguration).
 *
 * @param {number} courseOfferingId  Local CourseOffering PK
 * @param {{ course?: object }} options  Pass a pre-fetched course to skip the DB lookup
 * @returns {{ synced: number, created: number, deleted: number, errors: [] }}
 */
export async function syncCourseEnrollments(courseOfferingId, options = {}) {
  if (!Number.isFinite(courseOfferingId)) {
    return { synced: 0, created: 0, deleted: 0, errors: [] };
  }

  const course =
    options.course ??
    (await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } }));

  if (!course || !course.externalId || course.externalSource !== 'EDUAI') {
    return { synced: 0, created: 0, deleted: 0, errors: [] };
  }

  const allEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.externalId);
  const activeEnrollments = allEnrollments.filter((e) => e.isActive);

  // Guard: empty upstream means "no data yet" — don't wipe local rows
  if (activeEnrollments.length === 0) {
    return { synced: 0, created: 0, deleted: 0, errors: [] };
  }

  const activeUserIds = new Set(activeEnrollments.map((e) => e.studentId));

  const existing = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((e) => e.userId));

  const toCreate = activeEnrollments.filter((e) => !existingUserIds.has(e.studentId));
  const toDelete = existing.filter((e) => !activeUserIds.has(e.userId));

  if (toCreate.length > 0) {
    await prisma.courseEnrollment.createMany({
      data: toCreate.map((e) => ({ courseOfferingId, userId: e.studentId })),
      skipDuplicates: true,
    });
  }

  if (toDelete.length > 0) {
    await prisma.courseEnrollment.deleteMany({
      where: {
        courseOfferingId,
        userId: { in: toDelete.map((e) => e.userId) },
      },
    });
  }

  return {
    synced: activeEnrollments.length,
    created: toCreate.length,
    deleted: toDelete.length,
    errors: [],
  };
}
