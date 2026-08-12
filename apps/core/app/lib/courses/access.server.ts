import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";

type SessionUser = {
  id: string;
  role?: string | null;
  authorizedUnits?: string[] | null;
};

// Access levels allowed to manage a course's materials / embedding settings —
// the same admin/unit/instructor tier as `canEditCourse` (§7). TA and student
// enrollments never reach here.
const CAN_MANAGE_MATERIALS_LEVELS = new Set(["admin", "unit", "instructor"]);

/**
 * Course the user may manage materials / embedding settings for.
 *
 * Delegates to the canonical `resolveCourseAccessWithCourse` resolver (#225
 * AUTH-10) instead of re-deriving access from platform role alone, so a
 * UNIT_ADMIN acting in-unit and a grad-TA holding an INSTRUCTOR *enrollment*
 * (platform role STUDENT) are granted the same as they would be everywhere
 * else `resolveCourseAccess` gates a course. The resolver's course lookup
 * already filters `deletedAt: null` (#225 AUTH-11), so a soft-deleted course
 * can never be re-embedded through this helper.
 *
 * Uses the WIDE resolver on purpose: this helper hands the course row back to
 * its callers, which read the embedding columns (`embeddingProvider`,
 * `embeddingModel`, `embeddedWith*`, `lastEmbeddedAt`) — all outside
 * `GATE_COURSE_SELECT`.
 */
export async function getCourseIfCanManageMaterials(
  user: SessionUser,
  courseId: string,
) {
  const { course, access } = await resolveCourseAccessWithCourse(
    { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits },
    courseId,
  );
  if (!course || !access || !CAN_MANAGE_MATERIALS_LEVELS.has(access.level)) {
    return null;
  }
  return course;
}
