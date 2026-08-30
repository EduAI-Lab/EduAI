// @vitest-environment node
// #1495 review (non-blocking): every caller of `isChecksumConflict` reacts to a
// true by treating the failed write as a *content duplicate* — dropping the
// loser's row, reverting a `PROCESSING` flip, or writing a duplicate receipt.
// Matching on the bare `P2002` code therefore means any future unique index on
// `CourseMaterial` would have its violations silently reinterpreted as a
// checksum race instead of failing loudly. The predicate now checks the
// violated index when Prisma names it.
import { describe, expect, it } from "vitest";

import { isChecksumConflict } from "~/lib/materials/extraction-job.server";

/** The two shapes Prisma reports a violated index in, plus "not reported". */
type P2002Target = string[] | string | undefined;

function p2002(target?: P2002Target) {
  return { code: "P2002", clientVersion: "5.0.0", meta: target === undefined ? {} : { target } };
}

describe("isChecksumConflict", () => {
  it("matches the (courseId, checksum) violation Postgres reports", () => {
    expect(isChecksumConflict(p2002(["courseId", "checksum"]))).toBe(true);
  });

  it("rejects a P2002 on a different unique index", () => {
    expect(isChecksumConflict(p2002(["courseId", "externalId"]))).toBe(false);
  });

  it("accepts a string target naming the index", () => {
    expect(isChecksumConflict(p2002("CourseMaterial_courseId_checksum_key"))).toBe(true);
  });

  it("rejects a string target for another index", () => {
    expect(isChecksumConflict(p2002("CourseMaterial_courseId_externalId_key"))).toBe(false);
  });

  it("falls back to the bare code when no target is reported", () => {
    // Not every driver populates `meta.target`; a P2002 with nothing to check
    // must keep the pre-existing behaviour rather than fail the duplicate path.
    expect(isChecksumConflict(p2002())).toBe(true);
    expect(isChecksumConflict({ code: "P2002" })).toBe(true);
  });

  it("rejects anything that is not a P2002", () => {
    expect(isChecksumConflict({ code: "P2025" })).toBe(false);
    expect(isChecksumConflict(new Error("boom"))).toBe(false);
    expect(isChecksumConflict(null)).toBe(false);
    expect(isChecksumConflict("P2002")).toBe(false);
  });
});
