/**
 * Oracle for tests/models/validate-context-and-access.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Derived from the spec for `validateContextAndAccess`
 * (apps/extensions/ai-tutor/server/src/services/bugReports.js:145), not from
 * the function's branch order:
 *   - No context ids at all -> accepted immediately, no DB lookup, no
 *     role/authorization check (an uncontextualized bug report needs none).
 *   - The deepest provided id must reference a real row -> 400 otherwise.
 *   - Every provided ancestor id must match the DB-derived chain for that
 *     row -> 400 on any mismatch, checked before role/authorization.
 *   - Only STUDENT and INSTRUCTOR platform roles may submit a contextual
 *     report at all -> 403 for any other role.
 *   - A STUDENT must be enrolled in the resolved course; an INSTRUCTOR must
 *     instruct it -> 403 otherwise.
 */

export type ContextDepth = "none" | "course" | "module" | "lesson" | "activity";
export type Role = "STUDENT" | "INSTRUCTOR" | "OTHER";

export type ValidateContextAndAccessRow = {
  ContextDepth: ContextDepth;
  Existence: "exists" | "missing";
  Consistency: "consistent" | "inconsistent";
  Role: Role;
  Authorized: "yes" | "no";
};

export type Verdict = { ok: true } | { ok: false; status: 400 | 403 };

export function validateContextAndAccessOracle(row: ValidateContextAndAccessRow): Verdict {
  if (row.ContextDepth === "none") return { ok: true };
  if (row.Existence === "missing") return { ok: false, status: 400 };
  if (row.Consistency === "inconsistent") return { ok: false, status: 400 };
  if (row.Role === "OTHER") return { ok: false, status: 403 };
  if (row.Authorized === "no") return { ok: false, status: 403 };
  return { ok: true };
}
