/**
 * Oracle for tests/models/course-detail-manager-view.pict (census § S10).
 *
 * Spec-derived capability verdict for the manager-view UI mirrors vs backend
 * gates (issue #1189). One oracle; adapters run it against both the client
 * predicate and the backend gate — disagreement is the bug.
 *
 * Known drift (do not relax the oracle; use it.fails on the divergent side):
 *   - delete-material: UI uses canManageTopics (topics policy) as the
 *     "manage any material" staff bypass; backend materials use
 *     canDeleteMaterial (own-upload for TA, no topics policy). TA + topics
 *     policy on + other ownership is the divergent cell.
 *   - manage-rag: backend `PATCH /api/courses/:id/rag-settings` allows
 *     rank >= 2 (admin | unit | instructor); client only enables admin |
 *     instructor. Unit + manage-rag is the divergent cell (#1406).
 */

export type ManagerViewRow = {
  Access: "admin" | "unit" | "instructor" | "ta" | "student" | "none";
  Capability:
    | "manage-topics"
    | "manage-instructors"
    | "manage-students"
    | "staff-tab"
    | "chat-tab"
    | "manage-rag"
    | "delete-material";
  PolicyOn: "yes" | "no";
  MaterialOwn: "yes" | "no";
};

export type ManagerViewVerdict = {
  /** Whether the action/tab is allowed (enabled), not merely visible. */
  allowed: boolean;
  /** For tab capabilities: whether the tab is shown at all. */
  visible: boolean;
};

export type ManagerAccess =
  | "admin"
  | "unit"
  | "instructor"
  | "ta"
  | "student"
  | null;

export function managerViewAccess(row: ManagerViewRow): ManagerAccess {
  if (row.Access === "none") return null;
  return row.Access;
}

export function courseDetailManagerViewOracle(row: ManagerViewRow): ManagerViewVerdict {
  const access = managerViewAccess(row);
  const policyOn = row.PolicyOn === "yes";

  switch (row.Capability) {
    case "manage-topics": {
      if (access === "admin" || access === "unit" || access === "instructor") {
        return { allowed: true, visible: true };
      }
      if (access === "ta") return { allowed: policyOn, visible: true };
      return { allowed: false, visible: false };
    }
    case "manage-instructors": {
      const ok = access === "admin" || access === "unit";
      return { allowed: ok, visible: ok };
    }
    case "manage-students": {
      const ok = access === "admin" || access === "unit" || access === "instructor";
      return { allowed: ok, visible: ok };
    }
    case "staff-tab": {
      // manageEnrollmentsPolicyKey: admin/unit always; instructor via flag; else never
      if (access === "admin" || access === "unit") {
        return { allowed: true, visible: true };
      }
      if (access === "instructor") {
        return { allowed: policyOn, visible: true };
      }
      return { allowed: false, visible: false };
    }
    case "chat-tab": {
      // courseChatViewPolicyKey: admin always; instructor + unit via policy flag; else never
      if (access === "admin") return { allowed: true, visible: true };
      if (access === "instructor" || access === "unit") {
        return { allowed: policyOn, visible: true };
      }
      return { allowed: false, visible: false };
    }
    case "manage-rag": {
      // Backend rag-settings route: rank >= 2 (admin | unit | instructor).
      // Client UI still gates on admin | instructor only — see known divergence.
      const ok = access === "admin" || access === "unit" || access === "instructor";
      return { allowed: ok, visible: ok };
    }
    case "delete-material": {
      // Backend canDeleteMaterial: admin/unit/instructor any; TA own only.
      if (access === "admin" || access === "unit" || access === "instructor") {
        return { allowed: true, visible: true };
      }
      if (access === "ta") {
        return { allowed: row.MaterialOwn === "yes", visible: true };
      }
      return { allowed: false, visible: false };
    }
  }
}

/**
 * Client predicates that intentionally disagree with the oracle / backend:
 *   - delete-material: topics canManage staff bypass (#1390)
 *   - manage-rag: client omits unit while backend rank >= 2 includes it (#1406)
 */
export function managerViewClientKnownDivergence(row: ManagerViewRow): boolean {
  if (
    row.Capability === "delete-material" &&
    row.Access === "ta" &&
    row.PolicyOn === "yes" &&
    row.MaterialOwn === "no"
  ) {
    return true;
  }
  return row.Capability === "manage-rag" && row.Access === "unit";
}
