import prisma from "~/lib/prisma.server";
import type { CourseAccess } from "./types";

/**
 * "Does this account actually teach this course?" — the one question
 * `resolveCourseAccess` cannot answer for a platform ADMIN (#1843).
 *
 * `resolveAccess` (course-access.server.ts) decides by platform role first:
 *
 *   if (user.role === "ADMIN") return { course, access: LEVELS.admin };
 *
 * The enrollment is never read for an ADMIN, and an in-unit UNIT_ADMIN
 * short-circuits to `unit` the same way. Both are *more* access than
 * `instructor`, so nothing is missing for authorization — but the instructor
 * SURFACE is keyed on `access.level === "instructor"`, which those accounts can
 * never hold. That is why Dr. Abdallah runs two accounts: an admin login for
 * the admin surface and an instructor login to reach the instructor one.
 *
 * These helpers answer the enrollment question directly, so a single account
 * can reach both surfaces without widening what it may do. Being enrolled is a
 * strictly narrower fact than being an ADMIN.
 */

/** True when the user holds an active INSTRUCTOR enrollment on this course. */
export async function teachesCourse(userId: string, courseId: string): Promise<boolean> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: { role: true, isActive: true },
  });
  return enrollment?.isActive === true && enrollment.role === "INSTRUCTOR";
}

/**
 * Whether a caller may use `chatMode: "instructor"` on a course.
 *
 * Pure so the route gate and the course list that feeds it can be proved to
 * agree — #1659 introduced the ADMIN exclusion precisely because a loader and
 * a guard had drifted, leaving a course listed that the API then 403'd on
 * every turn.
 *
 * Instructor mode is scoped to ONE published course the caller actually
 * teaches. `access.level === "instructor"` already means exactly that. The
 * second arm adds the accounts whose platform role short-circuits the resolver
 * before it ever reads their enrollment — and only when that enrollment really
 * exists. It therefore grants nothing: such a caller already resolves to
 * `admin` or `unit` on this course, which outranks `instructor`.
 */
export function canUseInstructorChatMode(
  accessLevel: CourseAccess,
  isPublished: boolean,
  holdsInstructorEnrollment: boolean,
): boolean {
  if (!isPublished) return false;
  if (accessLevel === "instructor") return true;
  // Only the two levels that short-circuit ahead of the enrollment check.
  // A `ta` or `student` level is a real, lower answer and must stay denied.
  if (accessLevel !== "admin" && accessLevel !== "unit") return false;
  return holdsInstructorEnrollment;
}

/**
 * Whether to offer this account a switch into the instructor view.
 *
 * Only accounts whose platform role hides the instructor surface from them —
 * a plain INSTRUCTOR is already there and needs no switch.
 */
export function canSwitchToInstructorView(
  platformRole: string | null | undefined,
  taughtCourseCount: number,
): boolean {
  if (taughtCourseCount === 0) return false;
  return platformRole === "ADMIN" || platformRole === "UNIT_ADMIN";
}
