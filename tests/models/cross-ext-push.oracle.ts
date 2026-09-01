/**
 * Oracle for tests/models/cross-ext-push.pict (census docs/PICT_CENSUS.md § S10).
 *
 * Spec-derived QM→Core question push contract (issue #1189):
 *   - Drafts must not sync (caller must not POST).
 *   - POST /api/questions is session-cookie only — never service-key.
 *   - Missing session → 401.
 *   - No / insufficient course access → 403; missing course → 404.
 *   - Core down → 503 (or transport failure mapped there by the client).
 *   - Idempotency: fresh → 201; P2002 claim race → adopt/replay prior response;
 *     in-progress → 409 IDEMPOTENCY_IN_PROGRESS.
 */

export type CrossExtPushRow = {
  Draft: "yes" | "no";
  Session: "present" | "missing";
  CourseAccess: "allowed" | "forbidden" | "course-missing";
  CoreReachable: "yes" | "down-5xx";
  Idempotency: "fresh" | "adopt-p2002" | "in-progress";
};

export type CrossExtPushVerdict = {
  outcome:
    | "skip-draft"
    | "accept-201"
    | "adopt"
    | "unauthorized-401"
    | "forbidden-403"
    | "not-found-404"
    | "conflict-409"
    | "unavailable-503";
};

export function crossExtPushOracle(row: CrossExtPushRow): CrossExtPushVerdict {
  if (row.Draft === "yes") {
    return { outcome: "skip-draft" };
  }

  if (row.Session === "missing") {
    return { outcome: "unauthorized-401" };
  }

  if (row.CoreReachable === "down-5xx") {
    return { outcome: "unavailable-503" };
  }

  if (row.CourseAccess === "course-missing") {
    return { outcome: "not-found-404" };
  }

  if (row.CourseAccess === "forbidden") {
    return { outcome: "forbidden-403" };
  }

  // allowed + session + reachable
  if (row.Idempotency === "in-progress") {
    return { outcome: "conflict-409" };
  }
  if (row.Idempotency === "adopt-p2002") {
    return { outcome: "adopt" };
  }
  return { outcome: "accept-201" };
}
