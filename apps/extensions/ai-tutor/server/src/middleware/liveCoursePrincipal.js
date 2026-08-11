import { prisma } from '../config/database.js';
import {
  authorizeLiveCoursePrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from '../services/liveCoursePrincipal.js';
import { sendSafeError } from '../utils/safeErrors.js';

export async function enforceLiveCoursePrincipal(req, res, next, course) {
  if (!course || !req.user) return next();
  // Learner routes already consume the shared live enrollment result to make
  // their exact STUDENT/TA visibility decision. This outer fence exists for
  // staff principals, whose stale CourseInstructor rows previously bypassed
  // those learner gates.
  if (req.user.role === 'STUDENT' || req.user.role === 'TA') return next();
  if (req.liveCoursePrincipal?.courseOfferingId === course.id) return next();

  const principal = await authorizeLiveCoursePrincipal(course, req.user);
  if (principal.state === 'unavailable') {
    return res.status(503).json({
      error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
      code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
    });
  }
  if (principal.state !== 'allowed') {
    return res.status(403).json({ error: 'Not authorized for this course' });
  }
  req.liveCoursePrincipal = { ...principal, courseOfferingId: course.id };
  return next();
}

export function gateCourseById(paramName = 'courseId') {
  return async (req, res, next) => {
    if (req.user?.role === 'STUDENT' || req.user?.role === 'TA') return next();
    const id = Number(req.params[paramName]);
    if (!Number.isFinite(id)) return next();
    try {
      const course = await prisma.courseOffering.findUnique({ where: { id } });
      if (!course) return next();
      return enforceLiveCoursePrincipal(req, res, next, course);
    } catch (error) {
      return sendSafeError(res, error, 'Internal server error');
    }
  };
}

export function gateCourseThrough(model, paramName, include) {
  return async (req, res, next) => {
    if (req.user?.role === 'STUDENT' || req.user?.role === 'TA') return next();
    const id = Number(req.params[paramName]);
    if (!Number.isFinite(id)) return next();
    try {
      const row = await prisma[model].findUnique({ where: { id }, include });
      let course = row;
      while (course && !Object.hasOwn(course, 'coreOfferingId')) {
        course = course.courseOffering ?? course.module ?? course.lesson ?? course.activity ?? null;
      }
      if (!course) return next();
      return enforceLiveCoursePrincipal(req, res, next, course);
    } catch (error) {
      return sendSafeError(res, error, 'Internal server error');
    }
  };
}
