import { resolveCoreCourseById } from './courseResolver.js';
import { authorizeLiveStudentEnrollment } from './enrollmentSync.js';

export const LIVE_COURSE_AUTH_UNAVAILABLE_CODE = 'COURSE_AUTH_UNAVAILABLE';
export const LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE = 'Course authorization unavailable';

/** Resolve one current course principal without consulting pre-sync local relationships. */
export async function authorizeLiveCoursePrincipal(course, user) {
  if (!course?.id || !user?.id) return { state: 'denied', kind: null, role: null };

  if (user.role === 'ADMIN') {
    return { state: 'allowed', kind: 'ADMIN', role: 'ADMIN' };
  }

  if (user.role === 'UNIT_ADMIN') {
    const { course: coreCourse, coreUnavailable } = await resolveCoreCourseById(
      course.coreOfferingId,
    );
    if (coreUnavailable) return { state: 'unavailable', kind: null, role: null };
    const authorizedUnits = Array.isArray(user.authorizedUnits) ? user.authorizedUnits : [];
    const allowed =
      typeof coreCourse?.department === 'string' && authorizedUnits.includes(coreCourse.department);
    return {
      state: allowed ? 'allowed' : 'denied',
      kind: allowed ? 'UNIT_ADMIN' : null,
      role: null,
    };
  }

  const allowedRoles = user.role === 'INSTRUCTOR' ? ['INSTRUCTOR'] : ['STUDENT', 'TA'];
  const live = await authorizeLiveStudentEnrollment(course.id, user.id, {
    course,
    allowedRoles,
  });
  if (live.state !== 'allowed') return { state: live.state, kind: null, role: live.role };

  if (user.role === 'INSTRUCTOR' && live.role !== 'INSTRUCTOR') {
    return { state: 'denied', kind: null, role: live.role };
  }
  const kind = live.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'LEARNER';
  return { state: 'allowed', kind, role: live.role };
}
