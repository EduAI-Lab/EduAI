/**
 * Oracle for tests/models/course-access-across-apps.pict (census docs/PICT_CENSUS.md § S2).
 *
 * Contract:
 *   effective_access(user, app, course) =
 *     shared_course_rbac(role, enrollment, deleted, dept/units, isActive)
 *     ∩ app_role_floor(app)
 *
 * Derived from docs/implementations/rbac-matrix.md §3 / §19 and issue #1181 —
 * not from any single handler. The only declared per-app branch is the floor;
 * everything else must compute identically across Core, QM, and AI Tutor.
 *
 * Seeding convention (world-builders):
 *   - Core / AI Tutor: ADMIN|UNIT_ADMIN = platform role; INSTRUCTOR|TA|STUDENT =
 *     platform STUDENT + Enrollment / TaWidening.
 *   - Question Maker: platform role = Role for ADMIN|UNIT_ADMIN|INSTRUCTOR;
 *     Role=TA seeds platform STUDENT (fails QM_AUTHORIZED floor).
 */

export type CourseAccessRow = {
  Role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT";
  App: "core" | "ai-tutor" | "question-maker";
  Enrollment:
    | "none"
    | "inactive"
    | "active-INSTRUCTOR"
    | "active-TA"
    | "active-STUDENT";
  CourseState: "deleted" | "published" | "unpublished";
  UnitMatch: "in-unit" | "out-of-unit" | "null-dept";
  TaWidening: "plain-STUDENT" | "STUDENT-with-TA-enrollment";
};

export type AccessLevelName = "admin" | "unit" | "instructor" | "ta" | "student";

export type CourseAccessVerdict =
  | { outcome: "allowed"; level: AccessLevelName }
  | {
      outcome: "denied";
      reason: "app-floor" | "no-course" | "no-access" | "unpublished-student";
    };

/** Platform role the world-builder should seed for this row (drives app floor). */
export function platformRoleForRow(row: CourseAccessRow): CourseAccessRow["Role"] | "STUDENT" {
  if (row.App === "question-maker") {
    // Role=TA is seeded as platform STUDENT so QM_AUTHORIZED denies at the floor.
    if (row.Role === "TA") return "STUDENT";
    return row.Role;
  }
  if (row.Role === "ADMIN" || row.Role === "UNIT_ADMIN") return row.Role;
  return "STUDENT";
}

/**
 * App role floor — the only intentional per-app difference in the oracle.
 * Mirrors QM_AUTHORIZED = ADMIN | UNIT_ADMIN | INSTRUCTOR.
 */
export function passesAppRoleFloor(
  app: CourseAccessRow["App"],
  platformRole: string,
): boolean {
  if (app === "question-maker") {
    return platformRole === "ADMIN" || platformRole === "UNIT_ADMIN" || platformRole === "INSTRUCTOR";
  }
  return true;
}

/** Effective enrollment after TaWidening (TA-parity widening). */
export function effectiveEnrollment(
  row: CourseAccessRow,
): CourseAccessRow["Enrollment"] {
  if (row.TaWidening === "STUDENT-with-TA-enrollment") return "active-TA";
  return row.Enrollment;
}

type SharedResult =
  | { kind: "level"; level: AccessLevelName }
  | { kind: "no-course" }
  | { kind: "no-access" };

/**
 * Shared course RBAC layer — must match across all three apps.
 * Publish gate is applied in courseAccessOracle after this (caller composition).
 */
export function sharedCourseRbac(row: CourseAccessRow): SharedResult {
  if (row.CourseState === "deleted") return { kind: "no-course" };

  if (row.Role === "ADMIN") return { kind: "level", level: "admin" };

  if (row.Role === "UNIT_ADMIN" && row.UnitMatch === "in-unit") {
    return { kind: "level", level: "unit" };
  }

  const enrollment = effectiveEnrollment(row);
  switch (enrollment) {
    case "active-INSTRUCTOR":
      return { kind: "level", level: "instructor" };
    case "active-TA":
      return { kind: "level", level: "ta" };
    case "active-STUDENT":
      return { kind: "level", level: "student" };
    case "none":
    case "inactive":
    default:
      return { kind: "no-access" };
  }
}

/** Full effective access: shared_course_rbac ∩ app_role_floor (+ student publish gate). */
export function courseAccessOracle(row: CourseAccessRow): CourseAccessVerdict {
  if (!passesAppRoleFloor(row.App, platformRoleForRow(row))) {
    return { outcome: "denied", reason: "app-floor" };
  }

  const shared = sharedCourseRbac(row);
  if (shared.kind === "no-course") return { outcome: "denied", reason: "no-course" };
  if (shared.kind === "no-access") return { outcome: "denied", reason: "no-access" };

  if (shared.level === "student" && row.CourseState === "unpublished") {
    return { outcome: "denied", reason: "unpublished-student" };
  }

  return { outcome: "allowed", level: shared.level };
}

/** Compact row label for failure messages. */
export function formatCourseAccessRow(row: CourseAccessRow): string {
  return [
    `App=${row.App}`,
    `Role=${row.Role}`,
    `Enrollment=${row.Enrollment}`,
    `CourseState=${row.CourseState}`,
    `UnitMatch=${row.UnitMatch}`,
    `TaWidening=${row.TaWidening}`,
  ].join(" ");
}
