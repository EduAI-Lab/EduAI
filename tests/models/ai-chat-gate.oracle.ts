/**
 * Oracle for tests/models/ai-chat-gate.pict (census docs/PICT_CENSUS.md § S8).
 *
 * Derived from the spec for `POST /activities/:activityId/{teach,guide,custom}`
 * (handleAiInteraction, apps/extensions/ai-tutor/server/src/routes/activities.js),
 * not from the handler's branch order:
 *   - Only an authenticated platform-role STUDENT may use AI tutoring at all.
 *   - That STUDENT must be enrolled in the activity's course.
 *   - The activity must be reachable through a fully published chain: the
 *     course must be published live (Core), its module must be published,
 *     and its lesson must be published. All three are required — failing
 *     any single one denies access identically (403), which is exactly the
 *     shape hand-written tests under-cover (happy path plus one negative,
 *     never the full combination).
 *   - Which of the three tutoring modes (teach/guide/custom) is requested,
 *     and whether the dual-loop supervisor is enabled, must have NO effect
 *     on whether the gate opens — both are orthogonal to access control by
 *     design. This oracle's `DualLoop` dimension exists to lock that in as a
 *     regression contract, not because dualLoop is expected to matter.
 */

export type Access = "STUDENT_ENROLLED" | "STUDENT_NOT_ENROLLED" | "NON_STUDENT";
export type Mode = "teach" | "guide" | "custom";

export type AiChatGateRow = {
  Access: Access;
  CoursePublishedLive: "yes" | "no";
  ModulePublished: "yes" | "no";
  LessonPublished: "yes" | "no";
  Mode: Mode;
  DualLoop: "on" | "off";
};

export function isPublishChainOpen(row: AiChatGateRow): boolean {
  return row.CoursePublishedLive === "yes" && row.ModulePublished === "yes" && row.LessonPublished === "yes";
}

/**
 * Expected HTTP status for the gate. 200 here means "the gate opened" —
 * this model assumes the AI call itself always succeeds (mocked upstream in
 * the world-builder), so it never asserts response *content*.
 */
export function expectedGateStatus(row: AiChatGateRow): number {
  if (row.Access === "NON_STUDENT") return 403;
  if (row.Access === "STUDENT_NOT_ENROLLED") return 403;
  if (!isPublishChainOpen(row)) return 403;
  return 200;
}
