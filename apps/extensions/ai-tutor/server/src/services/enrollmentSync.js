import { prisma } from '../config/database.js';
import { listEduAiCourseEnrollmentsServiceKey } from './eduaiClient.js';

/**
 * Sync active student enrollments from Core into the local CourseEnrollment table.
 * Only STUDENT rows are imported (#578); TA and INSTRUCTOR access is not mirrored locally.
 *
 * - Creates rows for users active in Core but missing locally.
 * - Updates the `role` for rows whose Core role changed.
 * - Deletes rows for users no longer active in Core.
 * - No-ops if Core returns an empty active list (guards against data loss
 *   from transient misconfiguration).
 *
 * @param {number} courseOfferingId  Local CourseOffering PK
 * @param {{ course?: object }} options  Pass a pre-fetched course to skip the DB lookup
 * @returns {{ synced: number, created: number, updated: number, deleted: number, errors: [] }}
 */
export async function syncCourseEnrollments(courseOfferingId, options = {}) {
  if (!Number.isFinite(courseOfferingId)) {
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  }

  const course =
    options.course ??
    (await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } }));

  if (!course || !course.externalId || course.externalSource !== 'EDUAI') {
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  }

  const allEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.externalId);
  // AI Tutor local enrollments represent student access only (#578).
  const activeEnrollments = allEnrollments.filter(
    (e) => e.isActive && (e.role ?? 'STUDENT') === 'STUDENT',
  );

  // Guard: empty upstream means "no data yet" — don't wipe local rows
  if (activeEnrollments.length === 0) {
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  }

  const activeUserIds = new Set(activeEnrollments.map((e) => e.studentId));

  const existing = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId },
    select: { userId: true, role: true },
  });
  const existingByUserId = new Map(existing.map((e) => [e.userId, e]));

  const toCreate = activeEnrollments.filter((e) => !existingByUserId.has(e.studentId));
  const toDelete = existing.filter(
    (e) => !activeUserIds.has(e.userId) && e.role === 'STUDENT',
  );
  const toUpdate = activeEnrollments.filter((e) => {
    const local = existingByUserId.get(e.studentId);
    return local && local.role !== (e.role ?? 'STUDENT');
  });

  if (toCreate.length > 0) {
    await prisma.courseEnrollment.createMany({
      data: toCreate.map((e) => ({
        courseOfferingId,
        userId: e.studentId,
        role: e.role ?? 'STUDENT',
      })),
      skipDuplicates: true,
    });
  }

  for (const e of toUpdate) {
    await prisma.courseEnrollment.update({
      where: { courseOfferingId_userId: { courseOfferingId, userId: e.studentId } },
      data: { role: e.role ?? 'STUDENT' },
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
    updated: toUpdate.length,
    deleted: toDelete.length,
    errors: [],
  };
}
