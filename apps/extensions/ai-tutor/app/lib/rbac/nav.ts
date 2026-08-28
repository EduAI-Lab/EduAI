import type { AtNavItem, AtUser } from "./types";
import {
  canAccessAdminConsole,
  canViewCourseAnalytics,
  canViewCourseFeedback,
  usesInstructorShell,
} from "./permissions";

export function getNavForUser(user: AtUser | null | undefined): AtNavItem[] {
  const items: AtNavItem[] = [];

  // Dashboard is the shared landing page for every supported role — always
  // first so it reads as "home" the same way Core's sidebar does.
  if (user) {
    items.push({ key: "dashboard", title: "Dashboard", href: "/dashboard" });
  }

  if (user?.role === "STUDENT") {
    items.push({
      key: "my-courses",
      title: "Courses",
      href: "/student",
    });
  }

  if (usesInstructorShell(user)) {
    items.push({
      key: "teaching",
      title: "Courses",
      href: "/instructor",
    });
  }

  if (user?.role === "ADMIN") {
    // Admins get the same Courses dashboard as instructors (admin ⊇ instructor)
    // so every role shares one consistent landing page. Course-list/detail access
    // is granted server-side via the platform-admin branches in the API.
    items.push({ key: "admin-courses", title: "Courses", href: "/instructor" });
  }

  if (canAccessAdminConsole(user)) {
    // User management and enrollments are owned by EduAI Core (synced from Canvas
    // as source of truth); AI Tutor no longer exposes them. The admin console
    // hosts bug-report triage + AI configuration.
    items.push({ key: "admin-bug-reports", title: "Admin", href: "/admin" });
  }

  return items;
}

/**
 * Course-detail tab set for one course.
 *
 * `courseRole` is the viewer's role *on this course* (#1644). When given, the
 * staff tabs (Submissions/Feedback/Analytics) gate on it, not on the global
 * effective `user.role` — otherwise a global-effective TA (promoted by some
 * other course) sees staff tabs on a course where they're only a STUDENT, whose
 * content the server then 403s. Callers with no per-course role (tests, legacy)
 * omit it and keep the old global-role behaviour.
 */
export function getCourseDetailTabs(
  user: AtUser | null | undefined,
  courseRole?: AtUser["role"] | null,
) {
  const tabs: Array<{
    id: "content" | "submissions" | "feedback" | "analytics";
    label: string;
  }> = [{ id: "content", label: "Content" }];

  // Evaluate the staff permissions against the per-course role when it's known,
  // preserving authorizedUnits (unit-admin scoping) from the real user.
  const scoped: AtUser | null | undefined = courseRole
    ? { id: user?.id ?? "", authorizedUnits: user?.authorizedUnits, role: courseRole }
    : user;

  if (canViewCourseAnalytics(scoped) || scoped?.role === "TA") {
    tabs.push({ id: "submissions", label: "Submissions" });
  }

  if (canViewCourseFeedback(scoped)) {
    tabs.push({ id: "feedback", label: "Feedback" });
  }

  if (canViewCourseAnalytics(scoped)) {
    tabs.push({ id: "analytics", label: "Analytics" });
  }

  return tabs;
}
