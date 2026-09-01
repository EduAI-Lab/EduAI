/**
 * Oracle for tests/models/resolve-chat-read-access.pict (census docs/PICT_CENSUS.md § S7,
 * #1186).
 *
 * Derived from the §5c oversight contract documented on `resolveChatReadAccess`
 * (lib/chat-history/server.ts:129), not from copying its branches:
 *   - The chat's owner may always read it; so may an ADMIN.
 *   - Every other viewer needs the chat to be course-scoped AND a course-chat
 *     oversight policy flag open for their resolved access level AND the
 *     chat's owner to be an active enrolled STUDENT — oversight is scoped to
 *     watching students, so staff can never read each other's chats this way.
 *   - TA and plain STUDENT access levels have no oversight capability at all
 *     (the gate is `never` for them) regardless of any policy flag.
 */

export type ResolveChatReadAccessRow = {
  Owner: "yes" | "no";
  Admin: "yes" | "no";
  CourseId: "present" | "null";
  AccessLevel: "none" | "student" | "ta" | "instructor" | "unit";
  PolicyFlag: "on" | "off";
  OwnerActiveStudent: "yes" | "no";
};

export type Verdict = { outcome: "authorized"; isOwner: boolean } | { outcome: "denied" };

/** Mirrors courseChatViewPolicyKey: only instructor/unit carry a real flag; the rest are "never". */
function gateFor(level: ResolveChatReadAccessRow["AccessLevel"]): "never" | "flag" {
  return level === "instructor" || level === "unit" ? "flag" : "never";
}

export function resolveChatReadAccessOracle(row: ResolveChatReadAccessRow): Verdict {
  if (row.Owner === "yes") return { outcome: "authorized", isOwner: true };
  if (row.Admin === "yes") return { outcome: "authorized", isOwner: false };
  if (row.CourseId === "null") return { outcome: "denied" };

  const gate = gateFor(row.AccessLevel);
  if (gate === "never") return { outcome: "denied" };
  if (row.PolicyFlag === "off") return { outcome: "denied" };
  if (row.OwnerActiveStudent === "no") return { outcome: "denied" };

  return { outcome: "authorized", isOwner: false };
}
