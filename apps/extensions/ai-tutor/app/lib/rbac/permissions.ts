import type { Role } from "~/lib/types";
import type { AtCourseAccess, AtUser } from "./types";

export type EnrollmentRole = "STUDENT" | "TA" | "INSTRUCTOR";

export function isPlatformAdmin(user: AtUser | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function isUnitAdmin(user: AtUser | null | undefined): boolean {
  return user?.role === "UNIT_ADMIN";
}

export function isInstructorRole(user: AtUser | null | undefined): boolean {
  return user?.role === "INSTRUCTOR";
}

export function isTaPlatformRole(user: AtUser | null | undefined): boolean {
  return user?.role === "TA";
}

export function isStudentRole(user: AtUser | null | undefined): boolean {
  return user?.role === "STUDENT";
}

/** True when the user uses the instructor route shell (authoring or TA read-only). */
export function usesInstructorShell(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === "INSTRUCTOR" || user.role === "UNIT_ADMIN" || user.role === "TA";
}

export function resolvePlatformCourseAccess(user: AtUser | null | undefined): AtCourseAccess {
  if (!user?.role) return null;
  if (user.role === "ADMIN") return "admin";
  if (user.role === "UNIT_ADMIN") return "unit";
  if (user.role === "INSTRUCTOR") return "instructor";
  if (user.role === "TA") return "ta";
  if (user.role === "STUDENT") return "student";
  return null;
}

export function canManageContent(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === "admin" || access === "unit" || access === "instructor";
}

/**
 * #1660: ADMIN/UNIT_ADMIN/INSTRUCTOR can preview the learner experience
 * under /student/* without switching accounts — TA and STUDENT already have
 * their own real view there, so this is deliberately NOT "who can reach
 * /student/*" (see STUDENT_ROUTE_ROLES for that). Same role set as
 * canManageContent today; kept as its own named predicate since "can
 * preview as a student" is a distinct intent from "can manage content" even
 * though the two booleans currently coincide.
 *
 * #1660 review (ariqmuldi, PR #1667): this used to be a fourth independent copy of
 * the same boolean, defined inside StudentPreviewBanner.tsx (a UI
 * component's module) and imported into four route loaders plus a sibling
 * route's button-visibility check — the wrong dependency direction for
 * authorization logic. Moved here, the app's one RBAC source of truth,
 * consumed via useAtPermissions().
 */
export function canPreviewAsStudent(user: AtUser | null | undefined): boolean {
  return canManageContent(user);
}

/** A role that can preview /student/* as staff — never STUDENT/TA, who have their own real view there (#1660). */
export type PreviewRole = Exclude<Role, "STUDENT" | "TA">;

/** The role to show in the /student/* preview banner, or `undefined` for a real STUDENT/TA view (#1660). */
export function previewRole(user: AtUser | null | undefined): PreviewRole | undefined {
  // SAFETY: canPreviewAsStudent (via canManageContent/resolvePlatformCourseAccess)
  // only returns true for "admin" | "unit" | "instructor" access, i.e. user.role
  // is ADMIN, UNIT_ADMIN, or INSTRUCTOR — never STUDENT or TA.
  return canPreviewAsStudent(user) ? (user?.role as PreviewRole) : undefined;
}

/**
 * requireClientUser's allow-list for every /student/* content route (list,
 * course, module, lesson): the two roles with a real student view (STUDENT,
 * TA) plus the three that can preview it (#1660).
 */
export const STUDENT_ROUTE_ROLES: Role[] = ["STUDENT", "TA", "ADMIN", "UNIT_ADMIN", "INSTRUCTOR"];

export function canViewTeachingContent(user: AtUser | null | undefined): boolean {
  return usesInstructorShell(user);
}

/** Course lifecycle is owned by EduAI Core (#632); AI Tutor only imports/enables. */
export function canCreateCourse(_user: AtUser | null | undefined): boolean {
  return false;
}

export function canPublishContent(user: AtUser | null | undefined): boolean {
  return canManageContent(user);
}

export function canManageTopics(user: AtUser | null | undefined): boolean {
  return canManageContent(user);
}

export function canManageEnrollments(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === "ADMIN" || user.role === "UNIT_ADMIN" || user.role === "INSTRUCTOR";
}

export function canAssignTaRole(user: AtUser | null | undefined): boolean {
  return canManageEnrollments(user);
}

export function canViewCourseSubmissions(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === "admin" || access === "unit" || access === "instructor" || access === "ta";
}

export function canViewCourseFeedback(user: AtUser | null | undefined): boolean {
  return canViewCourseSubmissions(user);
}

/**
 * Grading is available to the same course-staff set as submission viewing
 * (instructors, TAs, unit admins, platform admins). Accepts an optional
 * pre-resolved `access` so callers that already computed it (e.g. a route
 * loader) don't need to recompute it.
 */
export function canGradeSubmissions(
  user: AtUser | null | undefined,
  access: AtCourseAccess = resolvePlatformCourseAccess(user),
): boolean {
  return access === "admin" || access === "unit" || access === "instructor" || access === "ta";
}

export function canViewCourseAnalytics(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === "admin" || access === "unit" || access === "instructor" || access === "ta";
}

export function canViewCourseStudentMetrics(user: AtUser | null | undefined): boolean {
  return canViewCourseAnalytics(user);
}

export function canAccessAdminConsole(user: AtUser | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function canSubmitBugReport(user: AtUser | null | undefined): boolean {
  // The server accepts a bug report from any authenticated role.
  return !!user?.role;
}

export function getRoleViewLabel(role: Role | string | undefined): string {
  switch (role) {
    case "ADMIN":
      return "Administrator";
    case "UNIT_ADMIN":
      return "Unit administrator";
    case "INSTRUCTOR":
      return "Instructor";
    case "TA":
      return "Teaching assistant";
    case "STUDENT":
      return "Student";
    default:
      return "User";
  }
}
