/**
 * Oracle for tests/models/trace-oversight-gate.pict (census docs/PICT_CENSUS.md § S8).
 *
 * Derived from the spec for `GET /admin/ai-traces`
 * (apps/extensions/ai-tutor/server/src/routes/admin.js), not from the
 * handler's branch order:
 *   - An invalid `courseId` query param is rejected (400) before anything
 *     else is resolved, including the Core catalog fetch.
 *   - A UNIT_ADMIN with an empty `authorizedUnits` sees nothing (200, empty
 *     list) unconditionally — this takes precedence over an explicit `unit`
 *     query param, even a foreign one: an empty-authorizedUnits UNIT_ADMIN
 *     asking for a unit they're plainly not authorized for still gets an
 *     empty list, not 403, because the emptiness check runs first.
 *   - A UNIT_ADMIN with units, requesting a unit NOT in their
 *     authorizedUnits, gets 403.
 *   - Below that: department scoping for a UNIT_ADMIN resolves through the
 *     Core course catalog. On a Core outage the catalog is empty, so a
 *     UNIT_ADMIN's department-matched course set is always empty too — a
 *     deliberate, documented fail-soft blackout, asserted here rather than
 *     left undefined.
 *   - An ADMIN's `unit` filter is optional, not an authorization boundary:
 *     no `unit` param means no department filter at all, so an ADMIN sees
 *     every course's traces even during the same Core outage that blacks
 *     out UNIT_ADMIN. Supplying `unit` makes an ADMIN's view depend on the
 *     catalog too, same as UNIT_ADMIN, since resolving *which* courses match
 *     that department still requires the catalog.
 */

export type Role = "ADMIN" | "UNIT_ADMIN";

export type TraceOversightGateRow = {
  Role: Role;
  AuthorizedUnits: "empty" | "nonempty";
  UnitParam: "absent" | "own" | "foreign";
  CoreAvailable: "yes" | "no";
  CourseIdParam: "absent" | "valid" | "invalid";
};

export function expectedStatus(row: TraceOversightGateRow): number {
  if (row.CourseIdParam === "invalid") return 400;
  if (row.Role === "UNIT_ADMIN" && row.AuthorizedUnits === "nonempty" && row.UnitParam === "foreign") return 403;
  return 200;
}

/** `X-Core-Status: unavailable` is set whenever the catalog fetch fails, for any role — before the 403 branch, but never reached on the 400 short-circuit. */
export function expectedCoreStatusHeader(row: TraceOversightGateRow): boolean {
  if (row.CourseIdParam === "invalid") return false;
  return row.CoreAvailable === "no";
}

/**
 * Does the caller see traces for a single seeded course in their own
 * department ("COSC")? `null` when the status isn't 200 (not meaningful).
 */
export function expectedSeesOwnCourseTraces(row: TraceOversightGateRow): boolean | null {
  if (expectedStatus(row) !== 200) return null;

  if (row.Role === "ADMIN") {
    if (row.UnitParam === "foreign") return false;
    if (row.UnitParam === "absent") return true; // no department filter at all
    // UnitParam === "own": resolving "own" still requires the catalog.
    return row.CoreAvailable === "yes";
  }

  // UNIT_ADMIN
  if (row.AuthorizedUnits === "empty") return false; // blacked out unconditionally
  // AuthorizedUnits nonempty, UnitParam is "own" or "absent" ("foreign" already returned 403 above).
  return row.CoreAvailable === "yes";
}
