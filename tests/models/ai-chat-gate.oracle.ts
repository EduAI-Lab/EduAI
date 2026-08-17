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
 *   - `ModeEnabled` asserts the SPEC: a request for a mode the activity has
 *     disabled must be denied. Custom mode already does this (400,
 *     `!activity.enableCustomMode`, `:1496`). Teach and guide do NOT — #1411
 *     — so any row that reaches this branch for teach/guide is a known,
 *     expected failure until #1411 is fixed (see the test file's
 *     `isKnownDrift`).
 *   - `SessionOwnership` asserts the SPEC: a client-supplied `chatId` that
 *     does not belong to the caller (for this activity/mode) must be
 *     rejected. The handler computes this lookup but never acts on it —
 *     #1412 — so a "foreign" row that reaches this branch is also a known,
 *     expected failure until #1412 is fixed.
 */

export type Access = "STUDENT_ENROLLED" | "STUDENT_NOT_ENROLLED" | "NON_STUDENT";
export type Mode = "teach" | "guide" | "custom";
export type SessionOwnership = "none" | "own" | "foreign";

export type AiChatGateRow = {
  Access: Access;
  CoursePublishedLive: "yes" | "no";
  ModulePublished: "yes" | "no";
  LessonPublished: "yes" | "no";
  Mode: Mode;
  DualLoop: "on" | "off";
  ModeEnabled: "yes" | "no";
  SessionOwnership: SessionOwnership;
};

export function isPublishChainOpen(row: AiChatGateRow): boolean {
  return row.CoursePublishedLive === "yes" && row.ModulePublished === "yes" && row.LessonPublished === "yes";
}

/** True once role/enrollment/publish admit the request — i.e. the point where `ModeEnabled`/`SessionOwnership` become reachable at all. */
export function isAdmittedPastAccessGate(row: AiChatGateRow): boolean {
  return row.Access === "STUDENT_ENROLLED" && isPublishChainOpen(row);
}

/**
 * Expected HTTP status for the gate, per SPEC (not current handler
 * behavior — see `isKnownDrift` in the test file for where this and
 * reality currently diverge). 200 here means "the gate opened" — this model
 * assumes the AI call itself always succeeds (mocked upstream in the
 * world-builder), so it never asserts response *content*.
 */
export function expectedGateStatus(row: AiChatGateRow): number {
  if (row.Access === "NON_STUDENT") return 403;
  if (row.Access === "STUDENT_NOT_ENROLLED") return 403;
  if (!isPublishChainOpen(row)) return 403;
  if (row.ModeEnabled === "no") return row.Mode === "custom" ? 400 : 403;
  if (row.SessionOwnership === "foreign") return 403;
  return 200;
}
