/**
 * Plain-language names for audit `actionCode`s, for summaries such as the admin
 * dashboard's Recent activity. Codes without an entry fall back to sentence
 * case ("COURSE_TA_ASSIGNED" → "Course TA assigned"), so a new code never shows
 * up raw.
 */
const AUDIT_ACTION_LABELS = new Map([
  ["USER_ROLE_CHANGED", "Role changed"],
  ["USER_TA_COURSES_CHANGED", "TA courses changed"],
  ["INVITATION_CREATED", "Invite sent"],
  ["INVITATION_RESENT", "Invite resent"],
  ["INVITATION_REVOKED", "Invite revoked"],
  ["COURSE_UPDATED", "Course updated"],
  ["ENROLLMENT_CSV_IMPORTED", "Enrollments imported"],
  ["BUG_REPORT_STATUS_CHANGED", "Bug report updated"],
  ["POLICY_FLAG_UPDATED", "Policy changed"],
  ["CANVAS_INTEGRATION_SAVED", "Canvas connected"],
  ["CANVAS_INTEGRATION_DELETED", "Canvas disconnected"],
]);

const ACRONYMS = new Set(["AI", "API", "TA", "CSV", "QM"]);

export function auditActionLabel(actionCode: string): string {
  const known = AUDIT_ACTION_LABELS.get(actionCode);
  if (known) return known;
  const words = actionCode
    .split("_")
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word) ? word : word.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
