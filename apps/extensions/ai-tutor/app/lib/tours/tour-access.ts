/**
 * Which AI Tutor tour a viewer is offered, by role and page (#1754). The tours
 * themselves live in `ai-tutor-tours.ts`.
 */
import type { Role } from "~/lib/types";
import type { AiTutorTourId } from "./ai-tutor-tours";

export function isLessonRoute(pathname: string) {
  return /^\/student\/lesson\/\d+$/.test(pathname);
}

/** STUDENT/TA on student routes, plus TA on the instructor shell (TAs can also use student flows). */
export function canAccessStudentTour(role: Role | undefined, pathname: string) {
  if (pathname.startsWith("/student")) {
    return role === "STUDENT" || role === "TA";
  }
  if (role === "TA" && pathname.startsWith("/instructor")) return true;
  return false;
}

/**
 * UNIT_ADMIN on the two screens the `unit-admin-orientation` tour covers.
 *
 * Scoped to the routes the tour actually visits, and to those *exactly*: the
 * tour opens on whichever step belongs to the current route
 * (`resolveStartStep` in `@eduai/ui`), so it is only *suggested* as this
 * page's tour where it has a step of its own; elsewhere `resolveHelpTourId`
 * still offers it, saying up front that it starts on another page.
 *
 * The tour is staff-voiced and unit-specific — extending it to INSTRUCTOR would
 * need its own copy, not just another role in this list.
 */
export function canAccessUnitAdminTour(role: Role | undefined, pathname: string) {
  if (role !== "UNIT_ADMIN") return false;
  return pathname === "/dashboard" || pathname === "/instructor";
}

export function resolveSuggestedTourId(
  role: Role | undefined,
  pathname: string,
): AiTutorTourId | null {
  if (canAccessUnitAdminTour(role, pathname)) return "unit-admin-orientation";
  if (!canAccessStudentTour(role, pathname)) return null;
  if (!pathname.startsWith("/student")) return "student-journey";
  return isLessonRoute(pathname) ? "student-lesson-help" : "student-journey";
}

/**
 * The tour the header help modal (#1754) offers: this page's own tour when it
 * has one, else the viewer's role tour. The modal says up front that the
 * fallback starts elsewhere, so navigating there (the tour engine opens on
 * step one when no step lives on this route) is expected.
 */
export function resolveHelpTourId(role: Role | undefined, pathname: string): AiTutorTourId | null {
  const suggested = resolveSuggestedTourId(role, pathname);
  if (suggested) return suggested;
  if (role === "STUDENT" || role === "TA") return "student-journey";
  if (role === "UNIT_ADMIN") return "unit-admin-orientation";
  return null;
}
