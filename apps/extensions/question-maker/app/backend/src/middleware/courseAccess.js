/**
 * Per-course RBAC for Question Maker (rbac-matrix.md §3, §16–§19).
 *
 * Mirrors Core's keystone (`apps/core/app/lib/auth/course-access.server.ts`) but
 * sources its data over HTTP instead of Prisma:
 *   - enrollments + course department via the service key (unscoped reads; QM
 *     applies the access logic itself),
 *   - `authorizedUnits` via the caller's session cookie on `/api/me` (the only
 *     caller-scoped endpoint, with no service-key path).
 *
 * A QM `Course` row is 1:1 with a Core course (unique `core_course_id`) and is
 * owned by whoever linked it. Access here is therefore resolved against the Core
 * enrollment/unit data, NOT QM ownership — except for courses not yet linked to
 * Core, where we fall back to owner-only instructor access.
 */
import { Course } from '../schema/index.js';
import {
  getCourseEnrollmentsFromCore,
  getCourseFromCore,
  getMyProfileFromCore,
} from '../services/coreApiService.js';

/** Resolved access levels and their numeric ranks (shared contract §3). */
export const LEVELS = {
  admin: { level: 'admin', rank: 4 },
  unit: { level: 'unit', rank: 3 },
  instructor: { level: 'instructor', rank: 2 },
  ta: { level: 'ta', rank: 1 },
  student: { level: 'student', rank: 0 },
};

/** Map a `min` option (level name or numeric rank) to a numeric rank. */
export function minRank(min) {
  if (typeof min === 'number') return min;
  return LEVELS[min]?.rank ?? LEVELS.instructor.rank;
}

/**
 * UNIT_ADMIN callers don't carry `authorizedUnits` on the QM session (Core's
 * `/api/sessions/validate` returns only id/email/name/role) — fetch lazily via
 * `/api/me` with the caller's cookie. Returns [] if unavailable.
 *
 * Exported so `courseListService.listCoursesForUser` can reuse it for the
 * UNIT_ADMIN unit-lock check in the batched list path (#1072 unified contract)
 * without duplicating the "already on req.user vs fetch /api/me" logic.
 */
export async function getAuthorizedUnits(reqUser, cookie) {
  if (Array.isArray(reqUser.authorizedUnits)) return reqUser.authorizedUnits;
  const profile = await getMyProfileFromCore(cookie).catch(() => null);
  return Array.isArray(profile?.authorizedUnits) ? profile.authorizedUnits : [];
}

/**
 * Resolve the caller's access for an already-loaded QM `Course` row, returning
 * the `{ level, rank }` access or null. Use this when the course has already
 * been fetched (e.g. a resource loader eager-loaded it) to avoid a re-query.
 *
 * @param {{id: string, role?: string, authorizedUnits?: string[]}} reqUser
 * @param {object} course  a loaded QM Course instance (must include userId + coreCourseId)
 * @param {{cookie?: string}} [opts]  caller cookie, forwarded to /api/me
 */
export async function resolveAccessForCourse(reqUser, course, { cookie } = {}) {
  if (!course) return null;

  if (reqUser.role === 'ADMIN') return LEVELS.admin;

  // Course not yet linked to Core: no enrollment data exists, so fall back to
  // owner-only instructor access (a TA/co-instructor has no access here).
  if (!course.coreCourseId) {
    if (reqUser.id === course.userId) return LEVELS.instructor;
    return null;
  }

  // UNIT_ADMIN unit lock (§19): a null department is never a match.
  if (reqUser.role === 'UNIT_ADMIN') {
    let coreCourse = null;
    try {
      // Unified contract (#1072): `department` is a FIELD read — service-key
      // first, so the result never depends on the caller's own Core
      // enrollment (cookie remains the fallback when no key is configured).
      coreCourse = await getCourseFromCore(course.coreCourseId, { cookie, preferCookie: false });
    } catch {
      if (reqUser.id === course.userId) return LEVELS.instructor;
      // fall through to enrollment check
    }
    const department = coreCourse?.department ?? null;
    if (department !== null) {
      const units = await getAuthorizedUnits(reqUser, cookie);
      if (units.includes(department)) return LEVELS.unit;
    }
    // Outside their units a UNIT_ADMIN may still hold an enrollment — fall through.
  }

  // Enrollment-based access (C column): only an active enrollment counts.
  let enrollments = [];
  try {
    const data = await getCourseEnrollmentsFromCore(course.coreCourseId, { cookie });
    enrollments = data?.enrollments ?? [];
  } catch (err) {
    // Service key missing or Core unreachable — allow the QM course owner to proceed locally.
    if (reqUser.id === course.userId) return LEVELS.instructor;
    return null;
  }

  const mine = enrollments.find((e) => e.studentId === reqUser.id && e.isActive);
  if (!mine) {
    // Linker may not appear in Core roster yet after a fresh link/sync.
    if (reqUser.id === course.userId) return LEVELS.instructor;
    return null;
  }

  switch (mine.role) {
    case 'INSTRUCTOR':
      return LEVELS.instructor;
    case 'TA':
      return LEVELS.ta;
    case 'STUDENT':
      return LEVELS.student;
    default:
      return null;
  }
}

/**
 * Resolve the caller's access to a QM course by id, returning both the loaded
 * QM `Course` row (so callers can distinguish 404 from 403, and scope queries
 * by the authorized course) and the `{ level, rank }` access — or null access.
 */
export async function resolveCourseAccessWithCourse(reqUser, qmCourseId, opts = {}) {
  const parsedId = Number(qmCourseId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return { course: null, access: null };

  const course = await Course.findOne({ where: { id: parsedId } });
  if (!course) return { course: null, access: null };

  const access = await resolveAccessForCourse(reqUser, course, opts);
  return { course, access };
}

/**
 * Shared-contract entry point: `resolveCourseAccess(user, courseId) → { level, rank } | null`.
 */
export async function resolveCourseAccess(reqUser, qmCourseId, opts) {
  const { access } = await resolveCourseAccessWithCourse(reqUser, qmCourseId, opts);
  return access;
}

/**
 * Express middleware factory gating a route by per-course access.
 *
 * @param {object}   options
 * @param {string|number} options.min  minimum level name ('ta'|'instructor'|...) or rank
 * @param {(req) => (number|string|null|Promise<number|string|null>)} options.getCourseId
 *        resolves the QM course id from the request (param/body, or by loading
 *        the addressed resource). Return null/undefined → 404.
 *
 * On success attaches `req.courseAccess` ({ level, rank }) and `req.qmCourse`
 * (the loaded Course instance) for downstream handlers/services.
 */
export function requireCourseAccess({ min, getCourseId }) {
  const required = minRank(min);
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const courseId = await getCourseId(req);
      if (courseId === null || courseId === undefined || courseId === '') {
        return res.status(404).json({ success: false, error: 'Course not found' });
      }

      const { course, access } = await resolveCourseAccessWithCourse(req.user, courseId, {
        cookie: req.headers.cookie,
      });

      if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' });
      }
      if (!access || access.rank < required) {
        return res.status(403).json({ success: false, error: 'Insufficient course access' });
      }

      req.courseAccess = access;
      req.qmCourse = course;
      next();
    } catch (error) {
      next(error);
    }
  };
}
