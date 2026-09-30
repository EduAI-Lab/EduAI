import type { UserRole } from "./types";

/**
 * #1840: who may be offered as a course instructor. Deliberately the whole
 * staff set rather than platform-role INSTRUCTOR alone — an ADMIN or UNIT_ADMIN
 * account can hold an INSTRUCTOR enrollment (`addEnrollment` never checks the
 * target's platform role), and the INSTRUCTOR-only list is exactly why
 * Dr. Abdallah ended up running two accounts (#1782). Shared by the course-page
 * instructor picker, the create-course instructor select, and create-course
 * validation so the three can never disagree.
 */
export const INSTRUCTOR_CANDIDATE_ROLES = [
  "ADMIN",
  "UNIT_ADMIN",
  "INSTRUCTOR",
] as const satisfies readonly UserRole[];
