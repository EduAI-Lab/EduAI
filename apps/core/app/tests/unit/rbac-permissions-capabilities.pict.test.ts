// @vitest-environment node
//
// PICT adapter (#1189, census docs/PICT_CENSUS.md § S10): rbac-permissions-capabilities
// Asserts permissions.ts pure helpers against the shared oracle.

import { describe, expect, it } from "vitest";
import {
  canDeleteMaterial,
  canManageTopics,
  canRenameMaterial,
  canViewCourseChats,
  canViewMaterial,
  canViewTopics,
} from "~/lib/rbac/permissions";
import type { PolicyKey } from "~/lib/policy.server";
import rbacCases from "../../../../../tests/models/rbac-permissions-capabilities.cases.json";
import {
  rbacAccess,
  rbacPermissionsCapabilitiesOracle,
  type RbacCapabilitiesRow,
} from "../../../../../tests/models/rbac-permissions-capabilities.oracle";

const rows = rbacCases as RbacCapabilitiesRow[];
const USER = "user-1";
const OWN = "user-1";
const OTHER = "user-2";

function actualAllowed(row: RbacCapabilitiesRow): boolean {
  const access = rbacAccess(row);
  const published = row.IsPublished === "yes";
  const policyOn = row.PolicyOn === "yes";
  const uploadedBy = row.MaterialOwn === "yes" ? OWN : OTHER;
  const policies: Partial<Record<PolicyKey, boolean>> = {
    "instructors.canViewCourseChats": policyOn,
    "unitAdmins.canViewUnitChats": policyOn,
  };

  switch (row.Capability) {
    case "view-material":
      return canViewMaterial(access, published);
    case "view-topics":
      return canViewTopics(access, published);
    case "delete-material":
      return canDeleteMaterial(access, USER, uploadedBy);
    case "rename-material":
      return canRenameMaterial(access, USER, uploadedBy);
    case "manage-topics":
      return canManageTopics(access, policyOn);
    case "view-course-chats":
      return canViewCourseChats(access, policies);
  }
}

describe.each(rows.map((row, index) => ({ row, index })))(
  "rbac-permissions-capabilities PICT row #$index $row.Access/$row.Capability",
  ({ row }) => {
    it("matches the shared oracle", () => {
      const expected = rbacPermissionsCapabilitiesOracle(row);
      expect(actualAllowed(row)).toBe(expected.allowed);
    });
  },
);
