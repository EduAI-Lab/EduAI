/**
 * Oracle for tests/models/material-visibility.pict (census docs/PICT_CENSUS.md § S1).
 *
 * Derived from the visibility spec (issue #1180), not from any single handler:
 *   - An anonymous caller is turned away before any material-level check runs.
 *   - A caller with no course access at all (not staff, not enrolled) is turned
 *     away the same way, before any material-level check runs — this is the
 *     course-level RBAC gate (docs/implementations/rbac-matrix.md §3), which is
 *     shared infrastructure, not something specific to material visibility.
 *   - Deleted material is invisible to everyone who clears that gate, on every
 *     path — soft-deleted is absent, not merely hidden.
 *   - Staff (ADMIN / UNIT_ADMIN-in-unit / enrolled INSTRUCTOR / enrolled TA)
 *     bypass the student visibility gate entirely, including the
 *     Canvas-unpublished clause — a material staff can read directly must
 *     never be invisible to that same staff member in RAG.
 *   - An enrolled STUDENT is additionally gated by VisibleToStudents,
 *     AvailableAt, and Unpublished (Canvas sync, #777).
 *
 * This file is intentionally app-agnostic (no imports from apps/core) — the
 * verdict is a semantic fact about the visibility rule, not about any one
 * enforcement site. Each path adapter (REST status code, RAG chunk inclusion)
 * maps the verdict to its own observable; see
 * apps/core/app/tests/integration/material-visibility.integration.test.ts,
 * which exercises all three paths (REST, hybrid-RAG, SQL-RAG) against every
 * row, rather than routing each row to a single path.
 */

export type MaterialVisibilityRow = {
  Role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT" | "ANON";
  Enrolled: "yes" | "no";
  VisibleToStudents: "true" | "false";
  AvailableAt: "past" | "future" | "null";
  Deleted: "yes" | "no";
  Unpublished: "yes" | "no";
};

export type Verdict =
  | { outcome: "visible" }
  | { outcome: "denied"; reason: "no-session" | "no-course-access" | "hidden-from-student" }
  | { outcome: "absent" };

const STAFF_ROLES = new Set<MaterialVisibilityRow["Role"]>([
  "ADMIN",
  "UNIT_ADMIN",
  "INSTRUCTOR",
  "TA",
]);

/**
 * Does this row's Role/Enrolled combination resolve to any course access at
 * all? ADMIN and UNIT_ADMIN reach the course through their platform role /
 * unit match, never through enrollment — the world-builder guarantees the
 * unit match for UNIT_ADMIN (this model has no UnitMatch dimension), so both
 * always have access. Everyone else needs an active enrollment.
 */
export function hasCourseAccess(row: MaterialVisibilityRow): boolean {
  if (row.Role === "ANON") return false;
  if (row.Role === "ADMIN" || row.Role === "UNIT_ADMIN") return true;
  return row.Enrolled === "yes";
}

function isStaff(row: MaterialVisibilityRow): boolean {
  return STAFF_ROLES.has(row.Role) && hasCourseAccess(row);
}

export function materialVisibilityOracle(row: MaterialVisibilityRow): Verdict {
  if (row.Role === "ANON") return { outcome: "denied", reason: "no-session" };
  if (!hasCourseAccess(row)) return { outcome: "denied", reason: "no-course-access" };
  if (row.Deleted === "yes") return { outcome: "absent" };
  if (isStaff(row)) return { outcome: "visible" };

  // Remaining case: an enrolled STUDENT.
  const hiddenFromStudent =
    row.VisibleToStudents === "false" ||
    row.AvailableAt === "future" ||
    row.Unpublished === "yes";
  return hiddenFromStudent
    ? { outcome: "denied", reason: "hidden-from-student" }
    : { outcome: "visible" };
}

/**
 * REST adapter: the exact HTTP status `routes/api/courses.materials.$.ts`
 * returns for `GET /api/courses/:courseId/materials/:materialId`.
 */
export function expectedRestStatus(row: MaterialVisibilityRow): number {
  const verdict = materialVisibilityOracle(row);
  switch (verdict.outcome) {
    case "visible":
      return 200;
    case "absent":
      return 404;
    case "denied":
      switch (verdict.reason) {
        case "no-session":
          return 401;
        case "no-course-access":
          return 403;
        case "hidden-from-student":
          return 403;
      }
  }
}

/**
 * RAG adapter (both hybrid and pure-vector go through this — that is the
 * point of the contract): should the seeded chunk be present in
 * `findRelevantContent`'s results?
 */
export function expectedRagIncluded(row: MaterialVisibilityRow): boolean {
  return materialVisibilityOracle(row).outcome === "visible";
}
