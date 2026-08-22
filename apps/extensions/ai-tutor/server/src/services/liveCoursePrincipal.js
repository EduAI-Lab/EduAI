import { resolveCoreCourseById } from "./courseResolver.js";
import {
  authorizeLiveStudentEnrollment,
  LIVE_ENROLLMENT_SYNC_TIMEOUT_MS,
} from "./enrollmentSync.js";

export const LIVE_COURSE_AUTH_UNAVAILABLE_CODE = "COURSE_AUTH_UNAVAILABLE";
export const LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE = "Course authorization unavailable";
export const LIVE_COURSE_AUTH_TIMEOUT_MS = LIVE_ENROLLMENT_SYNC_TIMEOUT_MS;

/**
 * Resolve one Core course for a staff authorization decision with a finite
 * deadline. The resolver normally propagates AbortSignal to fetch, but the
 * explicit race also protects this authorization boundary from a test double
 * or upstream client that ignores cancellation and never settles.
 */
export async function resolveLiveCoreCourseById(coreOfferingId, options = {}) {
  if (!coreOfferingId) return { course: null, coreUnavailable: false };

  const timeoutMs = options.timeoutMs ?? LIVE_COURSE_AUTH_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(
      new DOMException("Live course authorization timed out", "TimeoutError"),
    );
  }, timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  let onAbort;
  const unavailableOnAbort = new Promise((resolve) => {
    onAbort = () => resolve({ course: null, coreUnavailable: true });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([
      resolveCoreCourseById(coreOfferingId, { signal }),
      unavailableOnAbort,
    ]);
  } catch {
    return { course: null, coreUnavailable: true };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onAbort);
  }
}

export function isAllowedLiveCourseStaffPrincipal(principal) {
  return (
    principal?.state === "allowed" && ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"].includes(principal.kind)
  );
}

/** Resolve one current course principal without consulting pre-sync local relationships. */
export async function authorizeLiveCoursePrincipal(course, user) {
  if (!course?.id || !user?.id) return { state: "denied", kind: null, role: null };

  if (user.role === "ADMIN") {
    return { state: "allowed", kind: "ADMIN", role: "ADMIN" };
  }

  if (user.role === "UNIT_ADMIN") {
    const { course: coreCourse, coreUnavailable } = await resolveLiveCoreCourseById(
      course.coreOfferingId,
    );
    if (coreUnavailable) return { state: "unavailable", kind: null, role: null };
    const authorizedUnits = Array.isArray(user.authorizedUnits) ? user.authorizedUnits : [];
    const allowed =
      typeof coreCourse?.department === "string" && authorizedUnits.includes(coreCourse.department);
    if (allowed) return { state: "allowed", kind: "UNIT_ADMIN", role: null };

    // A UNIT_ADMIN may also be the live instructor of a course outside their
    // configured unit.  Resolve that relationship through Core before
    // consulting the local CourseInstructor mirror; a stale local assignment
    // must not grant authoring access after a demotion.
    const live = await authorizeLiveStudentEnrollment(course.id, user.id, {
      course,
      allowedRoles: ["INSTRUCTOR"],
    });
    const liveState = live.state ?? (live.allowed ? "allowed" : "denied");
    if (liveState !== "allowed" || live.role !== "INSTRUCTOR") {
      return { state: liveState, kind: null, role: live.role };
    }
    return { state: "allowed", kind: "INSTRUCTOR", role: "INSTRUCTOR" };
  }

  const allowedRoles = user.role === "INSTRUCTOR" ? ["INSTRUCTOR"] : ["STUDENT", "TA"];
  const live = await authorizeLiveStudentEnrollment(course.id, user.id, {
    course,
    allowedRoles,
  });
  const liveState = live.state ?? (live.allowed ? "allowed" : "denied");
  if (liveState !== "allowed") return { state: liveState, kind: null, role: live.role };

  if (user.role === "INSTRUCTOR" && live.role !== "INSTRUCTOR") {
    return { state: "denied", kind: null, role: live.role };
  }
  const kind = live.role === "INSTRUCTOR" ? "INSTRUCTOR" : "LEARNER";
  return { state: "allowed", kind, role: live.role };
}
