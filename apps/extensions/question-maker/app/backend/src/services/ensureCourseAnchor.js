/**
 * Idempotent ensure of a QM Course anchor for a Core course id (#1114 / #1270).
 *
 * All anchor writers (POST /api/course, auto-import, ADMIN catalog
 * materialization) share this helper so concurrent ensures serialize on the
 * same per-`coreCourseId` Postgres advisory lock and agree on one persisted
 * owner.
 *
 * Unique-conflict recovery re-reads OUTSIDE the transaction: a P2002 aborts
 * the Postgres transaction, so a reread through `tx` would fail with
 * "current transaction is aborted" and surface as 500 when racing a path that
 * somehow bypasses the lock.
 */
import { Prisma } from '@eduai/question-maker-prisma-client';
import { prisma } from '../config/database.js';

/** Advisory-lock namespace for QM course-anchor creation (#1114). */
export const COURSE_ANCHOR_LOCK_NS = 1114;

/** Largest value `| 0` can produce; `Math.abs` of this overflows int32. */
const INT32_MIN = -2147483648;

/** Stable positive int32 for pg_advisory_xact_lock's second key. */
export function courseAnchorAdvisoryLockKey(coreCourseId) {
  let h = 0;
  for (let i = 0; i < coreCourseId.length; i++) {
    h = (Math.imul(31, h) + coreCourseId.charCodeAt(i)) | 0;
  }
  if (h === 0) return 1;
  // Math.abs(INT32_MIN) is 2147483648, one past int32's max — the positive
  // counterpart isn't representable, so pg's `::int` cast throws. Clamp to
  // int32 max instead of overflowing.
  if (h === INT32_MIN) return 2147483647;
  return Math.abs(h);
}

/**
 * @param {string} userId
 * @param {string} coreCourseId
 * @returns {Promise<{ course: object, created: boolean }>}
 */
export async function ensureCourseAnchor(userId, coreCourseId) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Both args cast to int: pg_advisory_xact_lock only has bigint / (int, int)
      // overloads, and Prisma raw binding can infer mismatched types.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COURSE_ANCHOR_LOCK_NS}::int, ${courseAnchorAdvisoryLockKey(coreCourseId)}::int)`;

      const existing = await tx.course.findUnique({ where: { coreCourseId } });
      if (existing) {
        return { course: existing, created: false };
      }

      const course = await tx.course.create({
        data: { userId, coreCourseId },
      });
      return { course, created: true };
    });
  } catch (error) {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!isUniqueViolation) throw error;

    // Transaction already aborted/rolled back — reread with a fresh client.
    const course = await prisma.course.findUnique({ where: { coreCourseId } });
    if (!course) throw error;
    return { course, created: false };
  }
}
