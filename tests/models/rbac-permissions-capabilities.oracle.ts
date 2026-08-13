/**
 * Oracle for tests/models/rbac-permissions-capabilities.pict (census § S10).
 *
 * Spec-derived from docs/implementations/rbac-matrix.md — not from
 * permissions.ts. If the implementation disagrees with this oracle, that is
 * the bug (or a documented product overlay that must be cited here).
 *
 * Rules:
 *   §7 Course Materials
 *     - View: any course access; STUDENT only when the course is published
 *     - Delete: ADMIN / UNIT_ADMIN / INSTRUCTOR any; TA own-upload only (O)
 *     - Rename: not a separate matrix row — same ownership rule as delete
 *
 *   §8 Course Topics
 *     - View: same published-course rule as materials
 *     - Manage (create/edit/delete): ADMIN / UNIT_ADMIN / INSTRUCTOR only
 *       Product overlay: EnrollmentRole=TA may manage when the
 *       `tas.canManageTopics` policy flag is on (PolicyOn=yes). Base matrix
 *       marks TA as —; the overlay is the explicit policy gate.
 *
 *   §10 AI Chat + course-chat policy keys
 *     - Platform ADMIN may always view course chat content
 *     - INSTRUCTOR / UNIT_ADMIN only when their policy flag is on
 *       (`instructors.canViewCourseChats` / `unitAdmins.canViewUnitChats`)
 *     - TA / STUDENT / none: never
 */

export type RbacCapabilitiesRow = {
  Access: "admin" | "unit" | "instructor" | "ta" | "student" | "none";
  Capability:
    | "view-material"
    | "delete-material"
    | "rename-material"
    | "view-topics"
    | "manage-topics"
    | "view-course-chats";
  IsPublished: "yes" | "no";
  PolicyOn: "yes" | "no";
  MaterialOwn: "yes" | "no";
};

export type RbacCapabilitiesVerdict = { allowed: boolean };

export type RbacAccess =
  | "admin"
  | "unit"
  | "instructor"
  | "ta"
  | "student"
  | null;

export function rbacAccess(row: RbacCapabilitiesRow): RbacAccess {
  if (row.Access === "none") return null;
  return row.Access;
}

export function rbacPermissionsCapabilitiesOracle(
  row: RbacCapabilitiesRow,
): RbacCapabilitiesVerdict {
  const access = rbacAccess(row);
  const published = row.IsPublished === "yes";
  const policyOn = row.PolicyOn === "yes";
  const own = row.MaterialOwn === "yes";

  switch (row.Capability) {
    case "view-material":
    case "view-topics": {
      // §7 / §8 — no access → deny; student needs published course
      if (!access) return { allowed: false };
      if (access === "student") return { allowed: published };
      return { allowed: true };
    }
    case "delete-material":
    case "rename-material": {
      // §7 delete (rename mirrors ownership): staff any; TA own only
      if (access === "admin" || access === "unit" || access === "instructor") {
        return { allowed: true };
      }
      if (access === "ta") return { allowed: own };
      return { allowed: false };
    }
    case "manage-topics": {
      // §8 manage: instructor-or-above; TA only via tas.canManageTopics overlay
      if (access === "admin" || access === "unit" || access === "instructor") {
        return { allowed: true };
      }
      if (access === "ta") return { allowed: policyOn };
      return { allowed: false };
    }
    case "view-course-chats": {
      // §10 + course-chat policy keys: admin always; instructor/unit via flag
      if (access === "admin") return { allowed: true };
      if (access === "instructor" || access === "unit") {
        return { allowed: policyOn };
      }
      return { allowed: false };
    }
  }
}
