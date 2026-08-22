import { prisma } from "../config/database.js";
import {
  authorizeLiveCoursePrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/liveCoursePrincipal.js";
import { sendSafeError } from "../utils/safeErrors.js";

export async function enforceLiveCoursePrincipal(req, res, next, course) {
  if (!course || !req.user) return next();
  // Learner routes already consume the shared live enrollment result to make
  // their exact STUDENT/TA visibility decision. This outer fence exists for
  // staff principals, whose stale CourseInstructor rows previously bypassed
  // those learner gates.
  if (req.user.role === "STUDENT" || req.user.role === "TA") return next();
  if (req.liveCoursePrincipal?.courseOfferingId === course.id) return next();

  // Some nested route loaders intentionally select only the course anchor.
  // Load the local instructor relation for the live sync's input shape, but
  // never use this mirror as authority: authorizeLiveCoursePrincipal still
  // reconciles the exact live roster before returning a principal.
  let principalCourse = course;
  if (!Array.isArray(principalCourse.instructors) && principalCourse.id) {
    principalCourse =
      (await prisma.courseOffering.findUnique({
        where: { id: principalCourse.id },
        include: { instructors: { select: { userId: true } } },
      })) ?? course;
  }
  const principal = await authorizeLiveCoursePrincipal(principalCourse, req.user);
  if (principal.state === "unavailable") {
    return res.status(503).json({
      error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
      code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
    });
  }
  if (principal.state !== "allowed") {
    // AI tutoring endpoints retain their student-only response contract. The
    // route performs the platform-role check after loading the activity; this
    // early fence must not turn an instructor's normal 403 into a course
    // membership error while still allowing no content or side effect.
    if (req.user.role === "INSTRUCTOR" && /\/(teach|guide|custom)$/.test(req.path ?? "")) {
      return res.status(403).json({ error: "Only students can use AI tutoring" });
    }
    return res.status(403).json({ error: "Not authorized for this course" });
  }
  req.liveCoursePrincipal = { ...principal, courseOfferingId: course.id };
  return next();
}

export function gateCourseById(paramName = "courseId") {
  return async (req, res, next) => {
    if (req.user?.role === "STUDENT" || req.user?.role === "TA") return next();
    const id = Number(req.params[paramName]);
    if (!Number.isFinite(id)) return next();
    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) return next();
      return enforceLiveCoursePrincipal(req, res, next, course);
    } catch (error) {
      return sendSafeError(res, error, "Internal server error");
    }
  };
}

export function gateCourseThrough(model, paramName, include) {
  return async (req, res, next) => {
    if (req.user?.role === "STUDENT" || req.user?.role === "TA") return next();
    const id = Number(req.params[paramName]);
    if (!Number.isFinite(id)) return next();
    try {
      const row = await prisma[model].findUnique({ where: { id }, include });
      let course = row;
      while (course && !Object.hasOwn(course, "coreOfferingId")) {
        course = course.courseOffering ?? course.module ?? course.lesson ?? course.activity ?? null;
      }
      if (!course) return next();
      return enforceLiveCoursePrincipal(req, res, next, course);
    } catch (error) {
      return sendSafeError(res, error, "Internal server error");
    }
  };
}
