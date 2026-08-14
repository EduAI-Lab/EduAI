/**
 * Oracle for tests/models/cross-ext-read.pict (census docs/PICT_CENSUS.md § S10).
 *
 * Spec-derived extension→Core read contract (issue #1189), not a mirror of any
 * single handler if-chain:
 *
 *   - Course FIELD truth and publish state come from service-key (unscoped)
 *     reads. Cookie-scoped lists silently omit non-enrolled courses and must
 *     never be used as a field source (the silent-omission trap).
 *   - enrollment-role is cookie-only: role when enrolled, otherwise null.
 *   - soft-deleted entities are absent at the source (404 / filtered), not
 *     returned as tombstones — the leak class.
 *   - Core 5xx / network failure → null + coreStatus unavailable; publish-state
 *     fails closed to false.
 *   - Genuine 404 → null with coreStatus ok.
 *
 * `material` has no AT/QM client today; the oracle still states the contract
 * (soft-deleted/absent/down → null) so a future client cannot regress it. Ext
 * adapters skip present+material SUT cells and re-tier that note in the census.
 */

export type CrossExtReadRow = {
  Ext: "ai-tutor" | "question-maker";
  DataKind: "course-field" | "material" | "topic" | "publish-state" | "enrollment-role";
  Auth: "service-key" | "session-cookie";
  CoreState: "present" | "soft-deleted" | "absent-404" | "core-down-5xx";
  CallerEnrolled: "yes" | "no";
};

export type CrossExtReadVerdict = {
  /** Resolved payload present (course/topic/role). publish-state uses `published`. */
  outcome: "resolved" | "null" | "published-false" | "published-true";
  coreStatus: "ok" | "unavailable";
  reason:
    | "ok"
    | "core-down"
    | "absent"
    | "soft-deleted"
    | "silent-omission"
    | "not-enrolled";
};

/**
 * Cookie field-reads of course-field while not enrolled are the silent-omission
 * trap: the scoped list omits the course, so callers see null as if missing.
 */
function isSilentOmission(row: CrossExtReadRow): boolean {
  return (
    row.DataKind === "course-field" &&
    row.Auth === "session-cookie" &&
    row.CallerEnrolled === "no" &&
    row.CoreState === "present"
  );
}

export function crossExtReadOracle(row: CrossExtReadRow): CrossExtReadVerdict {
  if (row.CoreState === "core-down-5xx") {
    if (row.DataKind === "publish-state") {
      return { outcome: "published-false", coreStatus: "unavailable", reason: "core-down" };
    }
    return { outcome: "null", coreStatus: "unavailable", reason: "core-down" };
  }

  if (row.CoreState === "soft-deleted") {
    return { outcome: "null", coreStatus: "ok", reason: "soft-deleted" };
  }

  if (row.CoreState === "absent-404") {
    if (row.DataKind === "publish-state") {
      return { outcome: "published-false", coreStatus: "ok", reason: "absent" };
    }
    return { outcome: "null", coreStatus: "ok", reason: "absent" };
  }

  // present
  if (isSilentOmission(row)) {
    return { outcome: "null", coreStatus: "ok", reason: "silent-omission" };
  }

  if (row.DataKind === "enrollment-role") {
    if (row.CallerEnrolled === "yes") {
      return { outcome: "resolved", coreStatus: "ok", reason: "ok" };
    }
    return { outcome: "null", coreStatus: "ok", reason: "not-enrolled" };
  }

  if (row.DataKind === "publish-state") {
    return { outcome: "published-true", coreStatus: "ok", reason: "ok" };
  }

  return { outcome: "resolved", coreStatus: "ok", reason: "ok" };
}
