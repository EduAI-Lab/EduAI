import type { Role } from "~/lib/types";
import type { AppTourDefinition, AppTourId } from "./tour-types";
import { isBrowser } from "@eduai/ui/runtime-env";

export function markTourCompleted(tour: AppTourDefinition) {
  if (!isBrowser()) return;
  window.localStorage.setItem(tour.completionKey, "true");
}

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
 * (`resolveTourStartStep`), so offering it anywhere without a step of its own —
 * /settings, /help, or a course page under /instructor — would start a tour
 * that immediately navigates the reader somewhere else. Both routes stay
 * admitted while the tour runs, so the sidebar control can still stop it after
 * the hop from /dashboard to /instructor.
 *
 * The tour is staff-voiced and unit-specific — extending it to INSTRUCTOR would
 * need its own copy, not just another role in this list.
 */
export function canAccessUnitAdminTour(role: Role | undefined, pathname: string) {
  if (role !== "UNIT_ADMIN") return false;
  return pathname === "/dashboard" || pathname === "/instructor";
}

/** Whether any tour is on offer here — the sidebar footer control's gate. */
export function canAccessTour(role: Role | undefined, pathname: string) {
  return canAccessStudentTour(role, pathname) || canAccessUnitAdminTour(role, pathname);
}

export function resolveSuggestedTourId(role: Role | undefined, pathname: string): AppTourId | null {
  if (canAccessUnitAdminTour(role, pathname)) return "unit-admin-orientation";
  if (!canAccessStudentTour(role, pathname)) return null;
  if (!pathname.startsWith("/student")) return "student-journey";
  return isLessonRoute(pathname) ? "student-lesson-help" : "student-journey";
}

/**
 * The tour the header help modal (#1754) offers: this page's own tour when it
 * has one, else the viewer's role tour. Unlike the sidebar control, the modal
 * says up front that the fallback starts elsewhere, so navigating there (the
 * tour engine opens on step one when no step lives on this route) is expected.
 */
export function resolveHelpTourId(role: Role | undefined, pathname: string): AppTourId | null {
  const suggested = resolveSuggestedTourId(role, pathname);
  if (suggested) return suggested;
  if (role === "STUDENT" || role === "TA") return "student-journey";
  if (role === "UNIT_ADMIN") return "unit-admin-orientation";
  return null;
}
