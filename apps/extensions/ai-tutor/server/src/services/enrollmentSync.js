import { prisma } from '../config/database.js';
import { listEduAiCourseEnrollmentsServiceKey } from './eduaiClient.js';

// AI Tutor local enrollments mirror STUDENT and TA access (#1065); INSTRUCTOR
// access is tracked separately via CourseInstructor and never mirrored here.
const MIRRORED_ROLES = new Set(['STUDENT', 'TA']);

/**
 * How long a successful auto-sync is trusted before the next sync-before-read
 * call for the same course triggers another Core call. Only applies when the
 * caller opts in via `options.ttlMs` (read-path auto-sync, e.g.
 * `GET /courses/:courseId` and `GET /admin/courses/:courseId/enrollments`) —
 * an explicit POST .../sync-enrollments call always hits Core. Keeps a page
 * with many concurrent viewers from firing a Core request per request.
 * Mirrors `topicSync.js`'s `AUTO_SYNC_TTL_MS` (#1031).
 */
export const AUTO_SYNC_TTL_MS = 30_000;

/**
 * How long a sync-before-read caller will wait on Core before giving up and
 * serving the local mirror. Without this, a Core that's up but slow or hung
 * doesn't throw — it just holds the socket — so every reader blocks on
 * Core's latency instead of degrading gracefully like a hard failure does.
 * Mirrors `topicSync.js`'s `AUTO_SYNC_TIMEOUT_MS` (#1031).
 */
export const AUTO_SYNC_TIMEOUT_MS = 3_000;

const lastAutoSyncAt = new Map();

/**
 * Sync active student + TA enrollments from Core into the local
 * CourseEnrollment table. INSTRUCTOR access is not mirrored locally (owned by
 * CourseInstructor).
 *
 * - Creates rows for users active in Core but missing locally.
 * - Updates the `role` for rows whose Core role changed (including
 *   STUDENT<->TA transitions, #1065).
 * - Deletes rows for users no longer active in Core, or whose Core role is
 *   no longer STUDENT/TA.
 * - No-ops if Core returns an empty active list (guards against data loss
 *   from transient misconfiguration).
 * - Pass `options.ttlMs` to skip the Core call (and just report a no-op) if a
 *   sync for this course succeeded within the last `ttlMs` ms.
 * - Pass `options.signal` (e.g. `AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS)`)
 *   to bound the Core call; an abort surfaces like any other fetch failure
 *   and is tagged `phase: 'fetch'` on the thrown error.
 *
 * @param {number} courseOfferingId  Local CourseOffering PK
 * @param {{ course?: object, ttlMs?: number, signal?: AbortSignal }} options  Pass a pre-fetched course to skip the DB lookup
 * @returns {{ synced: number, created: number, updated: number, deleted: number, errors: [] }}
 */
export async function syncCourseEnrollments(courseOfferingId, options = {}) {
  if (!Number.isFinite(courseOfferingId)) {
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  }

  const course =
    options.course ??
    (await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } }));

  if (!course || !course.coreOfferingId) {
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  }

  if (options.ttlMs) {
    const lastSync = lastAutoSyncAt.get(courseOfferingId);
    if (lastSync && Date.now() - lastSync < options.ttlMs) {
      return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [], skipped: true };
    }
  }

  let allEnrollments;
  try {
    allEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId, {
      signal: options.signal,
    });
  } catch (e) {
    e.phase = e.phase || 'fetch';
    throw e;
  }

  const activeEnrollments = allEnrollments.filter(
    (e) => e.isActive && MIRRORED_ROLES.has(e.role ?? 'STUDENT'),
  );

  // Guard: empty upstream means "no data yet" — don't wipe local rows
  if (activeEnrollments.length === 0) {
    lastAutoSyncAt.set(courseOfferingId, Date.now());
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
    (e) => !activeUserIds.has(e.userId) && MIRRORED_ROLES.has(e.role),
  );
  const toUpdate = activeEnrollments.filter((e) => {
    const local = existingByUserId.get(e.studentId);
    return local && local.role !== (e.role ?? 'STUDENT');
  });

  try {
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
  } catch (e) {
    e.phase = 'write';
    throw e;
  }

  lastAutoSyncAt.set(courseOfferingId, Date.now());

  return {
    synced: activeEnrollments.length,
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    errors: [],
  };
}

/** Test-only: clears the per-course auto-sync TTL throttle so each test starts fresh. */
export function resetEnrollmentSyncThrottleForTests() {
  lastAutoSyncAt.clear();
}
