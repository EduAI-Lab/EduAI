/**
 * Client-side capability predicates for CourseDetailManagerView.
 * Kept pure so the PICT adapter (#1189) exercises the same gates the UI uses.
 */
import {
  canDeleteMaterial as rbacCanDeleteMaterial,
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
  /**
   * Approve / merge / dismiss on a generated topic (#1624). Rank >= 2 only,
   * matching `POST /api/courses/:courseId/topic-analysis`: a TA holding
   * `tas.canManageTopics` may still create and rename topics, but merge repoints
   * every question on a topic, so the endpoint excludes them — and a button that
   * is always going to 403 has no business being on screen.
   */
  canReviewTopicSuggestions: boolean;
  canDeleteMaterial: (uploadedBy: string | null | undefined) => boolean;
};

function gateAllows(gate: ChatViewGate, isEnabled: (key: PolicyKey) => boolean): boolean {
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
  // Mirrors the endpoint's rank >= 2, which includes unit admins.
  const canReviewTopicSuggestions =
    access === "admin" || access === "unit" || access === "instructor";

  // Own-upload for TA; admin/unit/instructor any — independent of topics policy (#1390).
  const canDeleteMaterial = (uploadedBy: string | null | undefined) =>
    rbacCanDeleteMaterial(access, currentUserId ?? "", uploadedBy ?? null);

  return {
    canManage,
    canAssignInstructor,
    showStaffTab,
    canManageStaff,
    showChatTab,
    canViewChats,
    canManageStudentEnrollments,
    canManageRagSettings,
    canReviewTopicSuggestions,
    canDeleteMaterial,
  };
}
