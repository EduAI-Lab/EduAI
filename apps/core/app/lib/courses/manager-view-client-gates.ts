/**
 * Client-side capability predicates for CourseDetailManagerView.
 * Kept pure so the PICT adapter (#1189) exercises the same gates the UI uses.
 */
import {
  canManageTopics,
  canManageInstructors,
  canManageStudents,
  courseChatViewPolicyKey,
  manageEnrollmentsPolicyKey,
  type ChatViewGate,
  type CourseAccess,
} from "~/lib/rbac";
import type { PolicyKey } from "~/lib/policy-flags";

export type ManagerViewClientGates = {
  canManage: boolean;
  canAssignInstructor: boolean;
  showStaffTab: boolean;
  canManageStaff: boolean;
  showChatTab: boolean;
  canViewChats: boolean;
  canManageStudentEnrollments: boolean;
  /** Client intentionally omits unit — diverges from backend rank >= 2 (#1406). */
  canManageRagSettings: boolean;
  canDeleteMaterial: (uploadedBy: string | null | undefined) => boolean;
};

function gateAllows(
  gate: ChatViewGate,
  isEnabled: (key: PolicyKey) => boolean,
): boolean {
  if (gate === "always") return true;
  if (gate === "never") return false;
  return isEnabled(gate);
}

export function resolveManagerViewClientGates(
  access: CourseAccess,
  isEnabled: (key: PolicyKey) => boolean,
  currentUserId?: string,
): ManagerViewClientGates {
  const canManage = canManageTopics(access, isEnabled("tas.canManageTopics"));
  const canAssignInstructor = canManageInstructors(access);
  const staffGate = manageEnrollmentsPolicyKey(access);
  const showStaffTab = staffGate !== "never";
  const canManageStaff = gateAllows(staffGate, isEnabled);
  const chatGate = courseChatViewPolicyKey(access);
  const showChatTab = chatGate !== "never";
  const canViewChats = gateAllows(chatGate, isEnabled);
  const canManageStudentEnrollments = canManageStudents(access);
  const canManageRagSettings = access === "admin" || access === "instructor";

  const canDeleteMaterial = (uploadedBy: string | null | undefined) => {
    if (canManage) return true;
    return (
      access === "ta" &&
      uploadedBy !== null &&
      uploadedBy !== undefined &&
      uploadedBy === currentUserId
    );
  };

  return {
    canManage,
    canAssignInstructor,
    showStaffTab,
    canManageStaff,
    showChatTab,
    canViewChats,
    canManageStudentEnrollments,
    canManageRagSettings,
    canDeleteMaterial,
  };
}
