/**
 * Oracle for tests/models/import-reconcile.pict (census docs/PICT_CENSUS.md § S4).
 *
 * Spec-derived verdict for Canvas → Core material import reconciliation
 * (issue #1183). Models the product rules for `importSingleCanvasFile`, not a
 * line-by-line copy of its if-chain:
 *
 *   1. Instructor exclusion list wins — excluded Canvas files are never imported.
 *   2. Unpublished upstream Canvas files are not imported (publish gate).
 *   3. A soft-deleted EduAI row is never revived by Canvas re-sync; import stops
 *      before any timestamp or checksum comparison (deletedAt short-circuits).
 *   4. When an existing row is READY and Canvas reports no newer timestamp,
 *      re-import is unnecessary (fresh-ready skip).
 *   5. When another course material already owns the same content checksum,
 *      skip to avoid duplicate blobs (checksum-dup skip).
 *   6. Otherwise: create when no matching external row exists, update when one does.
 *
 * Import is additive only — upstream Canvas deletion is not propagated; there is
 * no delete outcome.
 *
 * The SUT collapses three skip paths into one return string
 * (`skipped-not-modified`). This oracle splits them into distinguishable kinds so
 * the adapter can assert precedence even when the handler string is identical.
 */

export type ImportReconcileRow = {
  Excluded: "yes" | "no";
  CanvasPublished: "yes" | "no";
  ExistingPresent: "yes" | "no";
  DeletedAt: "yes" | "no";
  StaleAndReady: "yes" | "no";
  ChecksumDup: "yes" | "no";
};

export type ImportReconcileSkipKind =
  | "excluded"
  | "unpublished"
  | "deleted"
  | "not-modified-fresh-ready"
  | "checksum-dup"
  | "not-modified-other";

export type ImportReconcileVerdict =
  | { outcome: "imported" }
  | { outcome: "updated" }
  | { outcome: "skipped"; kind: ImportReconcileSkipKind };

/** Return strings emitted by `importSingleCanvasFile` today. */
export type ImportReconcileSutOutcome =
  | "imported"
  | "updated"
  | "skipped-excluded"
  | "skipped-unpublished"
  | "skipped-not-modified";

export function importReconcileOracle(row: ImportReconcileRow): ImportReconcileVerdict {
  if (row.Excluded === "yes") {
    return { outcome: "skipped", kind: "excluded" };
  }

  if (row.CanvasPublished === "no") {
    return { outcome: "skipped", kind: "unpublished" };
  }

  if (row.ExistingPresent === "yes" && row.DeletedAt === "yes") {
    return { outcome: "skipped", kind: "deleted" };
  }

  if (row.ExistingPresent === "yes" && row.StaleAndReady === "yes") {
    return { outcome: "skipped", kind: "not-modified-fresh-ready" };
  }

  if (row.ChecksumDup === "yes") {
    return { outcome: "skipped", kind: "checksum-dup" };
  }

  return row.ExistingPresent === "yes" ? { outcome: "updated" } : { outcome: "imported" };
}

/**
 * Maps the oracle verdict to the SUT's coarser return union. Three skip kinds
 * share `skipped-not-modified`; the adapter must compare via oracle kind, not
 * this string alone.
 */
export function expectedSutOutcome(row: ImportReconcileRow): ImportReconcileSutOutcome {
  const verdict = importReconcileOracle(row);
  switch (verdict.outcome) {
    case "imported":
      return "imported";
    case "updated":
      return "updated";
    case "skipped":
      switch (verdict.kind) {
        case "excluded":
          return "skipped-excluded";
        case "unpublished":
          return "skipped-unpublished";
        case "deleted":
        case "not-modified-fresh-ready":
        case "checksum-dup":
        case "not-modified-other":
          return "skipped-not-modified";
      }
  }
}
