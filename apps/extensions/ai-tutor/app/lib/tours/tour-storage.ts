import type { Role } from "~/lib/types";
import type { AppTourDefinition, AppTourId } from "./tour-types";

export function markTourCompleted(tour: AppTourDefinition) {
  if (typeof window === "undefined") return;
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
 * Scoped to the routes the tour actually visits: offering "Take tour" on
 * /settings or /help would start a tour that immediately navigates the reader
 * somewhere else. The tour is staff-voiced and unit-specific — extending it to
 * INSTRUCTOR would need its own copy, not just another role in this list.
 */
export function canAccessUnitAdminTour(role: Role | undefined, pathname: string) {
  if (role !== "UNIT_ADMIN") return false;
  return pathname === "/dashboard" || pathname.startsWith("/instructor");
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
