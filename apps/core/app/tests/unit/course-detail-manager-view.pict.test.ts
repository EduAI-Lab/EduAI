// @vitest-environment node
//
// PICT adapter (#1189, census docs/PICT_CENSUS.md § S10): course-detail-manager-view
// One oracle against client predicate mirrors and backend permission gates.
// Known TA delete-material drift uses it.fails (do not relax the oracle).

import { describe, expect, it } from "vitest";
import {
  accessLevelFor,
  canManageCourseRagSettings,
} from "~/lib/auth/course-access.server";
import {
  canDeleteMaterial,
  canManageInstructors,
  canManageStudents,
  canManageTopics,
  courseChatViewPolicyKey,
  manageEnrollmentsPolicyKey,
} from "~/lib/rbac/permissions";
import { resolveManagerViewClientGates } from "~/lib/courses/manager-view-client-gates";
import type { PolicyKey } from "~/lib/policy-flags";
import managerViewCases from "../../../../../tests/models/course-detail-manager-view.cases.json";
import {
  courseDetailManagerViewOracle,
  managerViewAccess,
  managerViewClientKnownDivergence,
  type ManagerViewRow,
  type ManagerViewVerdict,
} from "../../../../../tests/models/course-detail-manager-view.oracle";

const rows = managerViewCases as ManagerViewRow[];

const USER = "user-1";
const OWN = "user-1";
const OTHER = "user-2";

/** Client gates from the shared production helper used by CourseDetailManagerView. */
function clientVerdict(row: ManagerViewRow): ManagerViewVerdict {
  const access = managerViewAccess(row);
  if (access == null) {
    return { allowed: false, visible: false };
  }
  const policyOn = row.PolicyOn === "yes";
  const policies = {
    "tas.canManageTopics": policyOn,
    "instructors.canManageEnrollments": policyOn,
    "instructors.canViewCourseChats": policyOn,
    "unitAdmins.canViewUnitChats": policyOn,
  } as const;
  const isEnabled = (key: PolicyKey) => Boolean(policies[key as keyof typeof policies]);
  const gates = resolveManagerViewClientGates(access, isEnabled, USER);

  switch (row.Capability) {
    case "manage-topics":
      return { allowed: gates.canManage, visible: access === "ta" || gates.canManage };
    case "manage-instructors":
      return { allowed: gates.canAssignInstructor, visible: gates.canAssignInstructor };
    case "manage-students":
      return {
        allowed: gates.canManageStudentEnrollments,
        visible: gates.canManageStudentEnrollments,
      };
    case "staff-tab":
      return { allowed: gates.canManageStaff, visible: gates.showStaffTab };
    case "chat-tab":
      return { allowed: gates.canViewChats, visible: gates.showChatTab };
    case "manage-rag":
      return {
        allowed: gates.canManageRagSettings,
        visible: gates.canManageRagSettings,
      };
    case "delete-material": {
      const uploadedBy = row.MaterialOwn === "yes" ? OWN : OTHER;
      return {
        allowed: gates.canDeleteMaterial(uploadedBy),
        visible:
          access === "ta" ||
          gates.canManage ||
          access === "admin" ||
          access === "unit" ||
          access === "instructor",
      };
    }
  }
}

/** Backend gates used by routes / permissions.ts. */
function backendVerdict(row: ManagerViewRow): ManagerViewVerdict {
  const access = managerViewAccess(row);
  const policyOn = row.PolicyOn === "yes";
  const policies = {
    "tas.canManageTopics": policyOn,
    "instructors.canManageEnrollments": policyOn,
    "instructors.canViewCourseChats": policyOn,
    "unitAdmins.canViewUnitChats": policyOn,
  } as const;

  switch (row.Capability) {
    case "manage-topics": {
      const allowed = canManageTopics(access, policies["tas.canManageTopics"]);
      return { allowed, visible: access === "ta" || allowed };
    }
    case "manage-instructors": {
      const allowed = canManageInstructors(access);
      return { allowed, visible: allowed };
    }
    case "manage-students": {
      const allowed = canManageStudents(access);
      return { allowed, visible: allowed };
    }
    case "staff-tab": {
      const gate = manageEnrollmentsPolicyKey(access);
      const visible = gate !== "never";
      const allowed =
        gate === "always" || (gate !== "never" && Boolean(policies[gate as keyof typeof policies]));
      return { allowed, visible };
    }
    case "chat-tab": {
      const gate = courseChatViewPolicyKey(access);
      const visible = gate !== "never";
      const allowed =
        gate === "always" || (gate !== "never" && Boolean(policies[gate as keyof typeof policies]));
      return { allowed, visible };
    }
    case "manage-rag": {
      // Shared helper used by courses.id.rag-settings (rank >= 2).
      const allowed =
        access != null && canManageCourseRagSettings(accessLevelFor(access));
      return { allowed, visible: allowed };
    }
    case "delete-material": {
      const uploadedBy = row.MaterialOwn === "yes" ? OWN : OTHER;
      const allowed = canDeleteMaterial(access, USER, uploadedBy);
      return {
        allowed,
        visible:
          access === "ta" ||
          access === "admin" ||
          access === "unit" ||
          access === "instructor",
      };
    }
  }
}

describe.each(rows.map((row, index) => ({ row, index })))(
  "course-detail-manager-view PICT row #$index $row.Access/$row.Capability",
  ({ row }) => {
    const expected = courseDetailManagerViewOracle(row);

    it("backend gate matches the oracle", () => {
      expect(backendVerdict(row)).toEqual(expected);
    });

    const clientFn = managerViewClientKnownDivergence(row) ? it.fails : it;
    clientFn("client predicate matches the oracle", () => {
      expect(clientVerdict(row)).toEqual(expected);
    });
  },
);
