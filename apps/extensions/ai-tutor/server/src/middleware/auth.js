/**
 * @file Session validation and RBAC middleware for `/api/*` routes.
 *
 * Validates the incoming session cookie by calling Core's
 * `POST /api/sessions/validate` endpoint and populates `req.user`.
 */

import { getPolicy } from '../services/policyService.js';

const VALID_ROLES = new Set(['STUDENT', 'INSTRUCTOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'STUDENT';
}

/**
 * Validate the request's session cookie against Core and populate `req.user`.
 * Returns 401 if the cookie is absent, expired, or invalid.
 * `req.user` is set to `{ id, email, name, image, role }` on success.
 */
export async function requireAuth(req, res, next) {
  try {
    const response = await fetch(`${process.env.CORE_URL || 'http://localhost:3000'}/api/sessions/validate`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { user } = await response.json();
    req.user = { ...user, role: normalizeRole(user.role) };
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

/**
 * Build a middleware that requires the caller's role to be in `allowed`.
 * Pass a single role string or an array.
 *
 * Example: requireRole(['ADMIN', 'INSTRUCTOR'])
 *          requireRole('INSTRUCTOR')
 */
export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `One of the following roles required: ${roles.join(', ')}` });
    }
    next();
  };
}

export const requireRoles = requireRole;

/**
 * Gate that blocks INSTRUCTOR users when a Core policy flag is disabled.
 * ADMIN / UNIT_ADMIN are unaffected — they always hold the capability.
 * Place AFTER `requireRole` so role membership is already enforced; this only
 * narrows the INSTRUCTOR case based on the centrally-configured flag.
 *
 * Example: requireInstructorPolicy('instructors.canCreateCourses')
 */
export function requireInstructorPolicy(flagKey) {
  return async (req, res, next) => {
    if (req.user?.role !== 'INSTRUCTOR') {
      return next();
    }
    const allowed = await getPolicy(flagKey).catch(() => false);
    if (!allowed) {
      return res
        .status(403)
        .json({ error: 'Instructors are not permitted to perform this action' });
    }
    next();
  };
}

/**
 * Returns true when the user is a UNIT_ADMIN whose authorizedUnits includes
 * the course's department. A null/missing department is never a match (§19 unit lock).
 */
export function isUnitAdminForCourse(user, course) {
  return (
    user?.role === 'UNIT_ADMIN' &&
    course?.department != null &&
    Array.isArray(user.authorizedUnits) &&
    user.authorizedUnits.includes(course.department)
  );
}

/**
 * Returns true when the user has admin-level access to the course:
 * ADMIN globally, UNIT_ADMIN scoped to their department, or INSTRUCTOR of the course.
 * Requires course.instructors to be included.
 */
export function isCourseAdmin(user, course) {
  if (user?.role === 'ADMIN') return true;
  if (isUnitAdminForCourse(user, course)) return true;
  if (
    (user?.role === 'INSTRUCTOR' || user?.role === 'UNIT_ADMIN') &&
    course?.instructors?.some((i) => i.userId === user.id)
  )
    return true;
  return false;
}
