/**
 * Oracle for tests/models/auto-router-model-selection.pict (census docs/PICT_CENSUS.md § S3).
 *
 * Spec-derived verdict for Auto mode router selection (issue #1182). Models the product
 * rules for `resolveRoutedModel` and its mode-specific resolvers, not a line-by-line copy
 * of router.ts:
 *
 *   1. Per-request `modeOverride` (e.g. chat `model=auto-llm`) wins over `ROUTER_MODE`.
 *   2. Images are a *model-pool* constraint, not a routing-mode override (PR #1403: the
 *      dedicated image-escalation rule was retired because "the model family handles
 *      images natively... image presence is no longer a capability boundary"). Every
 *      mode picks its tier exactly as it would for a text-only prompt; `router.ts`'s
 *      `finalizePick` then filters the tier's candidate pool to `supportsImages` models
 *      uniformly across rules/kNN/hybrid/LLM picks. Pick source therefore follows the
 *      normal per-mode rule below regardless of `ImagesPresent`.
 *   3. Hybrid uses kNN tier pick only when neighbor confidence meets the minimum; otherwise
 *      it falls back to Phase-1 rules (same gate as `ROUTING_KNN_MIN_SIM`).
 *   4. LLM mode: tier-3 escalation rules win over the classifier (pick source rules).
 *   5. LLM mode: classifier failure is fail-open — silently downgrade pick source to rules
 *      while keeping LLM mode telemetry (`llm_classifier_fallback_rules`).
 *
 * This file is intentionally app-agnostic (no imports from apps/core). The adapter maps
 * the verdict to observable router features (`routerMode`, `pickSource`, `rule`, etc.).
 */

export type AutoRouterRow = {
  RouterMode: "rules" | "knn" | "hybrid" | "llm";
  ModeOverride: "none" | "rules" | "knn" | "hybrid" | "llm";
  ClassifierThrows: "yes" | "no";
  ImagesPresent: "yes" | "no";
  Tier3RuleMatch: "yes" | "no";
  KnnConfidence: "high" | "low";
};

export type RouterMode = AutoRouterRow["RouterMode"];
export type PickSource = "rules" | "knn" | "llm";

export type AutoRouterVerdict = {
  /** Active resolver (`resolveRoutedModel*` family) after override resolution. */
  effectiveMode: RouterMode;
  /** Which subsystem chose the tier/model pick (observable as `pickSource` in telemetry). */
  pickSource: PickSource;
  /** True when LLM classifier threw and pick source silently fell back to rules. */
  downgradedFromThrow: boolean;
};

/** Resolve effective router mode: override wins over env `ROUTER_MODE`. */
export function resolveEffectiveMode(row: AutoRouterRow): RouterMode {
  return row.ModeOverride === "none" ? row.RouterMode : row.ModeOverride;
}

export function autoRouterOracle(row: AutoRouterRow): AutoRouterVerdict {
  const effectiveMode = resolveEffectiveMode(row);

  // Images no longer redirect pick source to Phase-1 rules (see file header,
  // point 2) — `ImagesPresent` only constrains the candidate pool
  // (`requireImages`) applied uniformly after each mode's own tier pick, so
  // it falls straight through to the normal per-mode switch below.
  switch (effectiveMode) {
    case "rules":
      return { effectiveMode, pickSource: "rules", downgradedFromThrow: false };

    case "knn":
      return { effectiveMode, pickSource: "knn", downgradedFromThrow: false };

    case "hybrid":
      return {
        effectiveMode,
        pickSource: row.KnnConfidence === "high" ? "knn" : "rules",
        downgradedFromThrow: false,
      };

    case "llm":
      if (row.Tier3RuleMatch === "yes") {
        return { effectiveMode, pickSource: "rules", downgradedFromThrow: false };
      }
      if (row.ClassifierThrows === "yes") {
        return { effectiveMode, pickSource: "rules", downgradedFromThrow: true };
      }
      return { effectiveMode, pickSource: "llm", downgradedFromThrow: false };
  }
}

/** Stable rule id expected in router telemetry for the verdict. */
export function expectedRuleId(row: AutoRouterRow): string {
  const { effectiveMode, pickSource, downgradedFromThrow } = autoRouterOracle(row);

  if (downgradedFromThrow) {
    return "llm_classifier_fallback_rules";
  }

  if (pickSource === "knn" && effectiveMode === "hybrid") {
    return "hybrid_knn_tier";
  }

  if (pickSource === "knn") {
    return "knn_tier_vote";
  }

  if (pickSource === "llm") {
    return "llm_classifier";
  }

  // rules pickSource: Phase-1 rule id is prompt-dependent; adapter asserts pickSource only.
  return "phase1_rule";
}

/** Router version string stored on telemetry for the active mode. */
export function expectedRouterVersion(mode: RouterMode): string {
  switch (mode) {
    case "knn":
      return "v2-knn";
    case "hybrid":
      return "v2-hybrid";
    case "llm":
      return "v2-llm";
    default:
      return "v1-rules";
  }
}
