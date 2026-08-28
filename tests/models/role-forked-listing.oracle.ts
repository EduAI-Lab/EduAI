/**
 * Oracle for tests/models/role-forked-listing.pict (census docs/PICT_CENSUS.md § S6, #1185).
 *
 * Derived from the documented listing contract on each side, not from
 * copying either implementation's branches:
 *   - ADMIN always sees the course.
 *   - A UNIT_ADMIN whose authorized unit matches the course's department
 *     always sees it, regardless of any enrollment; outside their unit they
 *     fall back to whatever enrollment they personally hold, same as anyone
 *     else.
 *   - Core's enrollment fallback is keyed on ENROLLMENT role, never platform
 *     role (rbac-matrix.md §3): an INSTRUCTOR or TA enrollment sees the
 *     course in any publish state; a STUDENT enrollment only once published;
 *     no enrollment at all, no visibility.
 *   - ai-tutor forks the SAME rule per platform role instead: a platform
 *     INSTRUCTOR sees courses where they're the instructor-of-record
 *     (a separate relation, not the enrollment table); a platform STUDENT
 *     who additionally holds a TA enrollment OR a CourseInstructor row on
 *     this course sees it in any publish state (TA/instructor-of-record
 *     parity, #1386), a plain enrolled STUDENT only once published,
 *     otherwise nothing.
 *
 * #1386: a platform STUDENT holding Core enrollment-role INSTRUCTOR (or
 * ai-tutor's CourseInstructor row) used to be where the two forks disagreed
 * — visible in Core, not in ai-tutor, because ai-tutor's INSTRUCTOR branch
 * was platform-role gated instead of keying off the CourseInstructor
 * relation for a STUDENT too. Resolved by making ai-tutor's STUDENT fork
 * also honor a CourseInstructor row, matching Core's enrollment-only rule.
 */

export type RoleForkedListingRow = {
  PlatformRole: "STUDENT" | "INSTRUCTOR" | "UNIT_ADMIN" | "ADMIN";
  Enrollment: "none" | "student" | "ta" | "instructor";
  Published: "yes" | "no";
  UnitMatch: "in-unit" | "out-of-unit";
  Site: "core" | "ai-tutor";
};

export function courseVisibleCore(row: RoleForkedListingRow): boolean {
  if (row.PlatformRole === "ADMIN") return true;
  if (row.PlatformRole === "UNIT_ADMIN" && row.UnitMatch === "in-unit") return true;
  if (row.Enrollment === "instructor" || row.Enrollment === "ta") return true;
  if (row.Enrollment === "student") return row.Published === "yes";
  return false;
}

export function courseVisibleAiTutor(row: RoleForkedListingRow): boolean {
  if (row.PlatformRole === "ADMIN") return true;
  if (row.PlatformRole === "INSTRUCTOR") return row.Enrollment === "instructor";
  if (row.PlatformRole === "UNIT_ADMIN") {
    if (row.UnitMatch === "in-unit") return true;
    return row.Enrollment === "instructor";
  }
  // PlatformRole === "STUDENT"
  if (row.Enrollment === "ta" || row.Enrollment === "instructor") return true;
  if (row.Enrollment === "student") return row.Published === "yes";
  return false;
}

export function courseVisibleOracle(row: RoleForkedListingRow): boolean {
  return row.Site === "core" ? courseVisibleCore(row) : courseVisibleAiTutor(row);
}
