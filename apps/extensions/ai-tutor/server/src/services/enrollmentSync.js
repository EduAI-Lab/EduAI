import { prisma } from "../config/database.js";
import { listEduAiCourseEnrollmentsServiceKey } from "./eduaiClient.js";

// AI Tutor local enrollments mirror STUDENT and TA access (#1065); INSTRUCTOR
// access is tracked separately via CourseInstructor and never mirrored here.
const MIRRORED_ROLES = new Set(["STUDENT", "TA"]);

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

/**
 * Live student operations must not rely on the read-path mirror throttle. A
 * revoked Core enrollment therefore gets one bounded roster check per
 * sensitive request; there is deliberately no TTL here because a cache window
 * would turn revocation into a privilege-lag window.
 */
export const LIVE_ENROLLMENT_SYNC_TIMEOUT_MS = 3_000;
export const LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE = 'ENROLLMENT_AUTH_UNAVAILABLE';
export const LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE = 'Enrollment authorization unavailable';

const lastAutoSyncAt = new Map();
const localCourseLockTails = new Map();
const COURSE_ENROLLMENT_LOCK_PREFIX = 'ai-tutor:course-enrollment:';

/**
 * Serialize a course's roster fetch, local reconciliation, and any effective
 * role read. Production uses a PostgreSQL transaction-scoped advisory lock so
 * separate API replicas share the same lock. The Core request intentionally
 * runs inside that short transaction: releasing the lock between the fetch and
 * write would allow an older active snapshot to overwrite a newer revocation.
 * The local queue is only a test/runtime fallback for lightweight Prisma
 * doubles that do not expose `$transaction`; it is bounded by deleting its
 * tail when the operation settles. Callers must invoke this only at the
 * outermost reconciliation boundary; do not call it from inside another
 * `withCourseEnrollmentLock` callback for the same course.
 */
export async function withCourseEnrollmentLock(courseOfferingId, operation) {
  if (typeof prisma.$transaction === 'function') {
    return prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === 'function') {
        // `pg_advisory_xact_lock` returns PostgreSQL `void`, which Prisma
        // cannot deserialize through `$queryRaw` (P2010). Execute the SELECT
        // for its locking side effect instead.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${COURSE_ENROLLMENT_LOCK_PREFIX}${courseOfferingId}`}, 0)
          )
        `;
      }
      return operation(tx);
    });
  }

  const previous = localCourseLockTails.get(courseOfferingId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => operation(prisma));
  localCourseLockTails.set(courseOfferingId, current);
  return current.finally(() => {
    if (localCourseLockTails.get(courseOfferingId) === current) {
      localCourseLockTails.delete(courseOfferingId);
    }
  });
}

/**
 * Reconcile one caller's course enrollment against Core immediately before a
 * sensitive student operation. Core is authoritative: a local row is only
 * considered after an uncached, successful roster sync, and a missing/TA row
 * is denied even when a stale local STUDENT row existed beforehand.
 *
 * A Core/network/timeout/malformed-response or local-write/read failure is a
 * stable, fail-closed `unavailable` result. Callers must return 503 and must
 * not perform their provider or resource write in that case.
 *
 * @param {number} courseOfferingId Local CourseOffering primary key
 * @param {string} userId Authenticated Core user id
 * @param {{ course?: object, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<{allowed: boolean, state: 'allowed'|'denied'|'unavailable', role: string|null}>}
 */
export async function authorizeLiveStudentEnrollment(courseOfferingId, userId, options = {}) {
  if (!Number.isFinite(courseOfferingId) || typeof userId !== 'string' || userId.length === 0) {
    return { allowed: false, state: 'denied', role: null };
  }

  try {
    return await withCourseEnrollmentLock(courseOfferingId, async (db) => {
      const course =
        options.course ??
        (await db.courseOffering.findUnique({ where: { id: courseOfferingId } }));
      if (!course?.coreOfferingId) {
        // Without a Core link there is no authoritative roster to consult. Do
        // not fall back to a local row for a sensitive student operation.
        return { allowed: false, state: 'denied', role: null };
      }

      const signal =
        options.signal ?? AbortSignal.timeout(options.timeoutMs ?? LIVE_ENROLLMENT_SYNC_TIMEOUT_MS);
      // Do not pass ttlMs: this is intentionally a live authorization check.
      await syncCourseEnrollmentsLocked(courseOfferingId, { course, signal }, db);
      const enrollment = await db.courseEnrollment.findUnique({
        where: {
          courseOfferingId_userId: {
            courseOfferingId,
            userId,
          },
        },
        select: { role: true },
      });
      const role = enrollment?.role ?? null;
      const allowedRoles = new Set(
        Array.isArray(options.allowedRoles) && options.allowedRoles.length > 0
          ? options.allowedRoles
          : ['STUDENT'],
      );
      const allowed = role != null && allowedRoles.has(role);
      return { allowed, state: allowed ? 'allowed' : 'denied', role };
    });
  } catch {
    // Keep upstream details out of the route contract. The route can log the
    // error with its normal server-side policy, but callers see one stable 503
    // shape and never proceed with a provider/write side effect.
    return {
      allowed: false,
      state: 'unavailable',
      role: null,
    };
  }
}

/**
 * Sync active student + TA enrollments from Core into the local
 * CourseEnrollment table. INSTRUCTOR access is not mirrored locally (owned by
 * CourseInstructor).
 *
 * - Creates rows for users active in Core but missing locally.
 * - Updates the `role` for rows whose Core role changed (including
 *   STUDENT<->TA transitions, #1065).
 * - Deletes rows for users no longer active in Core, or whose Core role is
 *   no longer STUDENT/TA. A schema-validated empty roster is trusted and
 *   prunes all local STUDENT/TA rows (e.g. a revoked final TA) — Core's
 *   response is Zod-validated before this function ever sees it, so an
 *   empty list here means "really zero", not "malformed/misconfigured"
 *   (#1173).
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

  return withCourseEnrollmentLock(courseOfferingId, (db) =>
    syncCourseEnrollmentsLocked(courseOfferingId, options, db),
  );
}

/**
 * Reconcile one course while the caller holds the course lock. Keeping this
 * separate prevents `authorizeLiveStudentEnrollment` from releasing the lock
 * between reconciliation and its effective-role read.
 */
async function syncCourseEnrollmentsLocked(courseOfferingId, options, db) {
  const course =
    options.course ?? (await db.courseOffering.findUnique({ where: { id: courseOfferingId } }));

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
    e.phase = e.phase || "fetch";
    throw e;
  }

  const activeEnrollments = allEnrollments.filter(
    (e) => e.isActive && MIRRORED_ROLES.has(e.role ?? "STUDENT"),
  );

  const activeUserIds = new Set(activeEnrollments.map((e) => e.studentId));

  const existing = await db.courseEnrollment.findMany({
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
    return local && local.role !== (e.role ?? "STUDENT");
  });

  try {
    if (toCreate.length > 0) {
      await db.courseEnrollment.createMany({
        data: toCreate.map((e) => ({
          courseOfferingId,
          userId: e.studentId,
          role: e.role ?? "STUDENT",
        })),
        skipDuplicates: true,
      });
    }

    for (const e of toUpdate) {
      await db.courseEnrollment.update({
        where: { courseOfferingId_userId: { courseOfferingId, userId: e.studentId } },
        data: { role: e.role ?? "STUDENT" },
      });
    }

    if (toDelete.length > 0) {
      await db.courseEnrollment.deleteMany({
        where: {
          courseOfferingId,
          userId: { in: toDelete.map((e) => e.userId) },
        },
      });
    }
  } catch (e) {
    e.phase = "write";
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

/**
 * Evicts a single course's auto-sync TTL throttle entry. `lastAutoSyncAt`
 * lives for the process lifetime, so callers that delete a CourseOffering
 * (e.g. reconcile.js's Phase 1) must call this alongside the delete or the
 * throttle key leaks forever.
 */
export function clearEnrollmentSyncThrottle(courseOfferingId) {
  lastAutoSyncAt.delete(courseOfferingId);
}
