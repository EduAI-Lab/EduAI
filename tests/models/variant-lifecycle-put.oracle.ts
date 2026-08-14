/**
 * Oracle for tests/models/variant-lifecycle-put.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Derived from the spec for `PUT /api/questions/variants/:variantId`
 * (apps/extensions/question-maker/app/backend/src/routes/variants.js:137),
 * not from the handler's branch order:
 *   - An APPROVED variant's content is locked. The only edits allowed are
 *     reverting to draft (instructor-rank or above only) or changing ONLY
 *     `isAiGenerated` with nothing else in the request (the aiTagOnly
 *     allowlist) — anything else is 409 VARIANT_LOCKED, including a request
 *     that sets `isAiGenerated` alongside a content field or an explicit
 *     `isDraft`.
 *   - A DRAFT variant may be approved (isDraft:false) only by
 *     instructor-rank or above.
 *   - A DRAFT variant may be edited by a TA only if they created it;
 *     instructor-rank and above may edit any draft. Per the stated "TA
 *     own-only edit" invariant (rbac-matrix.md §19, #312), this SAME
 *     ownership check applies to the aiTagOnly path on an already-approved
 *     variant too — a TA who does not own an approved variant must not be
 *     able to retag it either (fixed in #1413/f8779e022).
 */

export type AccessLevel = "ta" | "instructor_plus";
export type DraftState = "draft" | "approved";
export type Ownership = "own" | "other";
export type RequestedIsDraft = "true" | "false" | "absent";
export type FieldChangeKind = "none" | "content" | "onlyAiTag";

export type VariantLifecyclePutRow = {
  AccessLevel: AccessLevel;
  CurrentIsDraft: DraftState;
  Ownership: Ownership;
  RequestedIsDraft: RequestedIsDraft;
  FieldChangeKind: FieldChangeKind;
};

function isInstructorPlus(row: VariantLifecyclePutRow): boolean {
  return row.AccessLevel === "instructor_plus";
}

function isReverting(row: VariantLifecyclePutRow): boolean {
  return row.RequestedIsDraft === "true" && isInstructorPlus(row);
}

function isAiTagOnly(row: VariantLifecyclePutRow): boolean {
  return row.FieldChangeKind === "onlyAiTag" && row.RequestedIsDraft === "absent";
}

function isNonOwnerTa(row: VariantLifecyclePutRow): boolean {
  return row.AccessLevel === "ta" && row.Ownership === "other";
}

export type Verdict = { status: 200 } | { status: 403; reason: "approve" | "not-own" } | { status: 409 };

export function variantLifecyclePutOracle(row: VariantLifecyclePutRow): Verdict {
  if (row.CurrentIsDraft === "approved") {
    if (isAiTagOnly(row) && isNonOwnerTa(row)) return { status: 403, reason: "not-own" };
    if (isReverting(row) || isAiTagOnly(row)) return { status: 200 };
    return { status: 409 };
  }

  // Draft.
  if (row.RequestedIsDraft === "false" && !isInstructorPlus(row)) return { status: 403, reason: "approve" };
  if (row.AccessLevel === "ta" && row.Ownership === "other") return { status: 403, reason: "not-own" };
  return { status: 200 };
}
