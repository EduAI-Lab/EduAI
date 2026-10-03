import prisma from "../prisma.server";
import { getAuthorizedUnits, type RbacUser } from "./course-access.server";

/**
 * #1659 review: the only authority for "which courses can this instructor
 * open a chat for" is an active INSTRUCTOR enrollment on a published course
 * — but that alone isn't enough to match `/api/chat`'s instructor-mode gate,
 * which reuses `resolveCourseAccessWithCourse` (course-access.server.ts).
 * That resolver decides access by PLATFORM role FIRST: every ADMIN gets
 * `admin`-level access and every in-unit UNIT_ADMIN gets `unit`-level access
 * — regardless of whether they *also* hold a real INSTRUCTOR enrollment on
 * the course, since enrollment is only consulted once neither short-circuit
 * applies. A raw enrollment lookup would therefore list a course here for a
 * dual-role caller that the API guard then always 403s on every turn. Those
 * callers have /admin/chat instead, so we exclude them here rather than
 * special-case the guard.
 *
 * #1745: also the root loader's source for the Course Assistant nav link, so
 * the link only shows when /instructor/chat won't bounce to /dashboard.
 */
export async function listInstructorChatCourses(user: RbacUser) {
  // Every ADMIN resolves to `admin`-level access on every course
  // (resolveAccess's first branch) — never `instructor`, no matter their
  // enrollment. Nothing they teach can ever pass the guard.
  if (user.role === "ADMIN") return [];

  const authorizedUnits = user.role === "UNIT_ADMIN" ? await getAuthorizedUnits(user) : null;

  const courses = await prisma.course.findMany({
    where: {
      isPublished: true,
      deletedAt: null,
      enrollments: { some: { userId: user.id, isActive: true, role: "INSTRUCTOR" } },
    },
    select: {
      id: true,
      code: true,
      name: true,
      startDate: true,
      section: true,
      department: true,
    },
    orderBy: { code: "asc" },
  });

  if (!authorizedUnits) return courses;

  // §19 unit lock (course-access.server.ts): a UNIT_ADMIN whose authorized
  // units include the course's department resolves to `unit`-level access
  // there — never `instructor` — regardless of their real enrollment. A
  // null department is never a unit match, so those courses fall through to
  // the (allowed) enrollment check same as the guard.
  return courses.filter((c) => c.department === null || !authorizedUnits.includes(c.department));
}
