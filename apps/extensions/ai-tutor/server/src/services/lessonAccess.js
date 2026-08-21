/**
 * @file Shared lesson membership / visibility for GET /lessons/:id family.
 *
 * The lesson body, breadcrumb, and tree-context routes all need the same
 * live-principal membership checks. Keep that in one place so student-vs-
 * elevated / Core-unavailable handling cannot drift (#1334 review).
 */
import {
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
} from "./enrollmentSync.js";
import { authorizeLiveCoursePrincipal } from "./liveCoursePrincipal.js";

/**
 * Exact live-course membership for a caller against one course offering.
 * Mirrors the development `getExactCourseMembership` helper used on list routes.
 *
 * @param {object} course CourseOffering (or compatible) passed to authorizeLiveCoursePrincipal
 * @param {{ id: string, role: string }} authUser
 */
export async function getExactCourseMembership(course, authUser) {
  const principal = await authorizeLiveCoursePrincipal(course, authUser);
  const liveTa = principal.state === "allowed" && principal.role === "TA";
  return {
    principal,
    isInstructor: principal.state === "allowed" && principal.kind === "INSTRUCTOR",
    isTa: liveTa,
    isStudent: principal.state === "allowed" && principal.role === "STUDENT",
    isUnitAdmin: principal.state === "allowed" && principal.kind === "UNIT_ADMIN",
    isAdmin: principal.state === "allowed" && principal.kind === "ADMIN",
  };
}

/**
 * Resolve whether `authUser` may see `lesson` and how sibling visibility
 * should be scoped.
 *
 * @param {{ id: string, role: string }} authUser
 * @param {{ isPublished: boolean, module: { courseOffering: object } }} lesson
 * @returns {Promise<{
 *   principal: object,
 *   isMember: boolean,
 *   hasElevatedAccess: boolean,
 *   publishedOnly: boolean,
 *   isStudent: boolean,
 *   authUnavailable: boolean,
 * }>}
 */
export async function resolveLessonAccess(authUser, lesson) {
  const membership = await getExactCourseMembership(lesson.module.courseOffering, authUser);
  const { principal, isInstructor, isTa, isStudent, isUnitAdmin: unitAdmin, isAdmin } = membership;

  if (principal.state === "unavailable") {
    return {
      principal,
      isMember: false,
      hasElevatedAccess: false,
      publishedOnly: false,
      isStudent: false,
      authUnavailable: true,
    };
  }

  const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
  const isMember = hasElevatedAccess || isStudent;
  const publishedOnly = isStudent && !hasElevatedAccess;

  return {
    principal,
    isMember,
    hasElevatedAccess,
    publishedOnly,
    isStudent,
    authUnavailable: false,
  };
}

/** Write the 503 body used when live course auth cannot be resolved. */
export function sendLessonAuthUnavailable(res, authUser) {
  const learner = authUser.role === "STUDENT" || authUser.role === "TA";
  return res.status(503).json({
    error: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE : "Course authorization unavailable",
    code: learner ? LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE : "COURSE_AUTH_UNAVAILABLE",
  });
}
