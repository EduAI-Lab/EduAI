/**
 * Oracle for tests/models/lesson-modules-view.pict (census docs/PICT_CENSUS.md § S8).
 *
 * Derived from the spec, not from either handler:
 *   - No session at all -> 401, before anything else is resolved.
 *   - The parent resource (lesson for the activities route, course for the
 *     modules route) not existing -> 404.
 *   - A caller who is neither elevated staff nor an enrolled STUDENT -> 403
 *     ("not a member"), on both routes — this is the shared
 *     `hasElevatedAccess`/`isMember` drift contract.
 *   - Below that, the two routes legitimately diverge in KIND, not by
 *     accident: the activities route gates a single lesson's activity list
 *     behind an explicit 403 when a non-elevated STUDENT requests an
 *     unpublished lesson; the modules route never 403s for an individual
 *     unpublished module — it silently filters unpublished modules out of a
 *     non-elevated STUDENT's list instead. Both adapters below encode their
 *     own real behavior; only the membership gate above is asserted equal
 *     across routes.
 */

export type Role = "ADMIN" | "INSTRUCTOR" | "TA" | "UNIT_ADMIN" | "STUDENT" | "NONE" | "ANON";

export type LessonModulesViewRow = {
  Role: Role;
  Published: "yes" | "no";
  Found: "yes" | "no";
};

const ELEVATED_ROLES = new Set<Role>(["ADMIN", "INSTRUCTOR", "TA", "UNIT_ADMIN"]);

/** `hasElevatedAccess` — the shared formula under drift contract. */
export function hasElevatedAccess(row: LessonModulesViewRow): boolean {
  return ELEVATED_ROLES.has(row.Role);
}

/** `isMember` — elevated staff, or an enrolled STUDENT. */
export function isMember(row: LessonModulesViewRow): boolean {
  return hasElevatedAccess(row) || row.Role === "STUDENT";
}

export type MembershipVerdict = "no-session" | "not-found" | "not-a-member" | "member";

/** The membership gate shared identically by both routes. */
export function membershipVerdict(row: LessonModulesViewRow): MembershipVerdict {
  if (row.Role === "ANON") return "no-session";
  if (row.Found === "no") return "not-found";
  if (!isMember(row)) return "not-a-member";
  return "member";
}

const MEMBERSHIP_STATUS: Record<MembershipVerdict, number> = {
  "no-session": 401,
  "not-found": 404,
  "not-a-member": 403,
  member: 200, // placeholder; overridden by each adapter below when member
};

/** `GET /lessons/:lessonId/activities` adapter. */
export function expectedActivitiesListStatus(row: LessonModulesViewRow): number {
  const verdict = membershipVerdict(row);
  if (verdict !== "member") return MEMBERSHIP_STATUS[verdict];
  const isNonElevatedStudent = row.Role === "STUDENT" && !hasElevatedAccess(row);
  if (isNonElevatedStudent && row.Published === "no") return 403;
  return 200;
}

/** `GET /courses/:courseId/modules` adapter — never 403s for publish state. */
export function expectedModulesListStatus(row: LessonModulesViewRow): number {
  const verdict = membershipVerdict(row);
  return verdict !== "member" ? MEMBERSHIP_STATUS[verdict] : 200;
}

/**
 * Whether the one seeded module appears in a 200 response's list for the
 * modules route. `null` when the request doesn't reach 200 (not meaningful).
 */
export function expectedModuleVisibleInList(row: LessonModulesViewRow): boolean | null {
  if (expectedModulesListStatus(row) !== 200) return null;
  if (hasElevatedAccess(row)) return true;
  // Only remaining member type reaching a 200: an enrolled, non-elevated STUDENT.
  return row.Published === "yes";
}
