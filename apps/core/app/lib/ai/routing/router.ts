/**
 * Routing layer entrypoint — Phase 1 rules, Phase 3 kNN / hybrid / LLM classifier.
 *
 * - **`rules.ts`** — interpretable rule stack
 * - **`knn.ts`** — embedding kNN tier vote from seed exemplars
 * - **`carbon-policy.ts`** — greener / quality tie-break on tier pool
 * - **`tiers.ts`** — DB-backed model pick
 */

import { matchPhase1Rules, type Phase1RouterContext } from "./rules";
import { pickModelForSpec, type TierModelRow, type PickSpec } from "./tiers";
import {
  parseCarbonPolicyByCourse,
  parseCarbonPolicyMode,
  resolveCarbonPolicyMode,
  tieBreakForTier,
} from "./carbon-policy";
import {
  parseKnnMinSimilarity,
  predictTierKnn,
  type KnnTierPrediction,
} from "./knn";
import {
  classifyPromptForTier,
  tierFromLlmClassification,
  type LlmRouteClassification,
} from "./llm-classifier";
import {
  isLocalVllmRouting,
  localVllmFallbackModelId,
  normalizePickForLocalVllm,
} from "./local-vllm";

export const ROUTER_VERSION_RULES = "v1-rules";
export const ROUTER_VERSION_KNN = "v2-knn";
export const ROUTER_VERSION_HYBRID = "v2-hybrid";
export const ROUTER_VERSION_LLM = "v2-llm";

/** @deprecated Use `ROUTER_VERSION_RULES` — kept for chat telemetry compatibility */
export const ROUTER_VERSION = ROUTER_VERSION_RULES;

export type RouterMode = "rules" | "knn" | "hybrid" | "llm";

export function parseRouterMode(raw: string | undefined): RouterMode {
  const v = raw?.trim().toLowerCase();
  if (v === "knn") {
    return "knn";
  }
  if (v === "hybrid") {
    return "hybrid";
  }
  if (v === "llm" || v === "classifier" || v === "auto-llm") {
    return "llm";
  }
  return "rules";
}

export function resolveRouterMode(): RouterMode {
  return parseRouterMode(process.env.ROUTER_MODE);
}

export function routerVersionForMode(mode: RouterMode): string {
  if (mode === "knn") {
    return ROUTER_VERSION_KNN;
  }
  if (mode === "hybrid") {
    return ROUTER_VERSION_HYBRID;
  }
  if (mode === "llm") {
    return ROUTER_VERSION_LLM;
  }
  return ROUTER_VERSION_RULES;
}

export type ResolveRouterOptions = {
  /** Per-request override (e.g. `model=auto-llm`). Wins over `ROUTER_MODE`. */
  modeOverride?: RouterMode;
};

/**
 * Extra signals for routing (chat passes these from RAG prefetch + message metadata).
 */
export type RouterInputContext = {
  courseId: string | null;
  /** Course code for carbon policy overrides (optional). */
  courseCode?: string | null;
  imagesPresent: boolean;
  messageTokenCount?: number;
  ragTopSimilarity?: number | null;
  ragChunkCount?: number | null;
  ragContextTokenEstimate?: number | null;
  courseRagNeeded?: boolean;
};

export type RouterDecision = {
  modelId: string;
  tier: 1 | 2 | 3;
  features: Record<string, unknown>;
};

const FALLBACK_MODEL = "google:gemini-2.5-flash";

function defaultFallbackModelId(): string {
  if (isLocalVllmRouting()) {
    return localVllmFallbackModelId();
  }
  if (process.env.VLLM_BASE_URL?.trim()) {
    return "vllm:qwen2.5-7b-instruct";
  }
  return FALLBACK_MODEL;
}

const carbonByCourse = () =>
  parseCarbonPolicyByCourse(process.env.ROUTING_CARBON_MODE_BY_COURSE);

function buildPhase1Context(
  prompt: string,
  ctx: RouterInputContext,
): Phase1RouterContext {
  return {
    prompt: prompt.trim(),
    imagesPresent: ctx.imagesPresent,
    courseId: ctx.courseId,
    ragTopSimilarity: ctx.ragTopSimilarity,
    ragChunkCount: ctx.ragChunkCount,
    ragContextTokenEstimate: ctx.ragContextTokenEstimate,
    courseRagNeeded: ctx.courseRagNeeded,
  };
}

function tierFromRow(row: TierModelRow | null, fallback: 1 | 2 | 3): 1 | 2 | 3 {
  if (!row) {
    return fallback;
  }
  const t = row.tier;
  if (t === 1 || t === 2 || t === 3) {
    return t;
  }
  return fallback;
}

function pickSpecFromTier(
  tier: 1 | 2 | 3,
  ctx: RouterInputContext,
  ruleOverride?: PickSpec,
): PickSpec {
  if (ruleOverride) {
    return ruleOverride;
  }
  const policy = resolveCarbonPolicyMode({
    globalMode: parseCarbonPolicyMode(process.env.ROUTING_CARBON_MODE),
    courseCode: ctx.courseCode,
    byCourse: carbonByCourse(),
  });
  const tieBreak = tieBreakForTier(tier, policy);
  return { kind: "exactTier", tier, tieBreak };
}

async function finalizePick(
  pick: PickSpec,
  meta: {
    routerVersion: string;
    rule: string;
    mode: RouterMode;
    knn?: KnnTierPrediction | null;
    llm?: LlmRouteClassification | null;
    phaseCtx: Phase1RouterContext;
    context: RouterInputContext;
    pickSource: "rules" | "knn" | "hybrid" | "llm";
  },
): Promise<RouterDecision> {
  const normalizedPick = normalizePickForLocalVllm(pick);
  let fallbackUsed = false;
  let picked: TierModelRow | null = await pickModelForSpec(normalizedPick);

  if (!picked) {
    fallbackUsed = true;
    picked = await pickModelForSpec(
      normalizePickForLocalVllm({
        kind: "exactTier",
        tier: isLocalVllmRouting() ? 3 : 2,
        tieBreak: "carbon",
      }),
    );
  }

  let modelId: string;
  let tier: 1 | 2 | 3;

  if (picked) {
    modelId = picked.registryId;
    tier = tierFromRow(
      picked,
      normalizedPick.kind === "exactTier" ? normalizedPick.tier : isLocalVllmRouting() ? 3 : 2,
    );
  } else {
    fallbackUsed = true;
    modelId = defaultFallbackModelId();
    tier = modelId.includes("32b") ? 3 : modelId.startsWith("vllm:") ? 1 : 2;
  }

  const features: Record<string, unknown> = {
    routerVersion: meta.routerVersion,
    routerMode: meta.mode,
    pickSource: meta.pickSource,
    rule: meta.rule,
    pick: normalizedPick,
    promptLength: meta.phaseCtx.prompt.length,
    imagesPresent: meta.phaseCtx.imagesPresent,
    messageTokenCount: meta.context.messageTokenCount ?? null,
    ragTopSimilarity: meta.phaseCtx.ragTopSimilarity ?? null,
    ragChunkCount: meta.phaseCtx.ragChunkCount ?? null,
    ragContextTokenEstimate: meta.phaseCtx.ragContextTokenEstimate ?? null,
    courseRagNeeded: meta.phaseCtx.courseRagNeeded ?? false,
    carbonPolicy: resolveCarbonPolicyMode({
      globalMode: parseCarbonPolicyMode(process.env.ROUTING_CARBON_MODE),
      courseCode: meta.context.courseCode,
      byCourse: carbonByCourse(),
    }),
    chosenRegistryId: modelId,
    chosenTierFromDb: picked?.tier ?? null,
    fallbackUsed,
    ...(meta.knn
      ? {
          knnTier: meta.knn.tier,
          knnConfidence: meta.knn.confidence,
          knnTopNeighbor: meta.knn.neighbors[0]?.prompt ?? null,
          knnTopSimilarity: meta.knn.neighbors[0]?.similarity ?? null,
          knnExemplarCount: meta.knn.exemplarCount,
        }
      : {}),
    ...(meta.llm
      ? {
          llmTask: meta.llm.task,
          llmComplexity: meta.llm.complexity,
          llmConfidence: meta.llm.confidence,
        }
      : {}),
  };

  return { modelId, tier, features };
}

/** Phase 1 rule-based routing (unchanged behaviour). */
export async function resolveRoutedModelRules(
  prompt: string,
  context: RouterInputContext,
): Promise<RouterDecision> {
  const phaseCtx = buildPhase1Context(prompt, context);
  const match = matchPhase1Rules(phaseCtx);

  return finalizePick(match.pick, {
    routerVersion: ROUTER_VERSION_RULES,
    rule: match.rule,
    mode: "rules",
    knn: null,
    phaseCtx,
    context,
    pickSource: "rules",
  });
}

/** Phase 3 kNN tier + carbon policy model pick. Images still use rule 1. */
export async function resolveRoutedModelKnn(
  prompt: string,
  context: RouterInputContext,
): Promise<RouterDecision> {
  const phaseCtx = buildPhase1Context(prompt, context);
  const match = matchPhase1Rules(phaseCtx);

  if (phaseCtx.imagesPresent) {
    return finalizePick(match.pick, {
      routerVersion: ROUTER_VERSION_KNN,
      rule: match.rule,
      mode: "knn",
      knn: null,
      phaseCtx,
      context,
      pickSource: "rules",
    });
  }

  const knn = await predictTierKnn(prompt);
  const pick = pickSpecFromTier(knn.tier, context);

  return finalizePick(pick, {
    routerVersion: ROUTER_VERSION_KNN,
    rule: "knn_tier_vote",
    mode: "knn",
    knn,
    phaseCtx,
    context,
    pickSource: "knn",
  });
}

/**
 * Hybrid: rules when kNN confidence is low; otherwise kNN tier + carbon policy.
 */
export async function resolveRoutedModelHybrid(
  prompt: string,
  context: RouterInputContext,
): Promise<RouterDecision> {
  const phaseCtx = buildPhase1Context(prompt, context);
  const match = matchPhase1Rules(phaseCtx);

  if (phaseCtx.imagesPresent) {
    return finalizePick(match.pick, {
      routerVersion: ROUTER_VERSION_HYBRID,
      rule: match.rule,
      mode: "hybrid",
      knn: null,
      phaseCtx,
      context,
      pickSource: "rules",
    });
  }

  const knn = await predictTierKnn(prompt);
  const minSim = parseKnnMinSimilarity(process.env.ROUTING_KNN_MIN_SIM);
  const useKnn = knn.confidence >= minSim;

  if (useKnn) {
    const pick = pickSpecFromTier(knn.tier, context);
    return finalizePick(pick, {
      routerVersion: ROUTER_VERSION_HYBRID,
      rule: "hybrid_knn_tier",
      mode: "hybrid",
      knn,
      phaseCtx,
      context,
      pickSource: "knn",
    });
  }

  return finalizePick(match.pick, {
    routerVersion: ROUTER_VERSION_HYBRID,
    rule: match.rule,
    mode: "hybrid",
    knn,
    phaseCtx,
    context,
    pickSource: "rules",
  });
}

/**
 * P3 LLM classifier: dedicated tier-1 router call, then carbon-aware model pick.
 * Hard rules still win for images (tier ≥ 2).
 */
export async function resolveRoutedModelLlm(
  prompt: string,
  context: RouterInputContext,
): Promise<RouterDecision> {
  const phaseCtx = buildPhase1Context(prompt, context);
  const match = matchPhase1Rules(phaseCtx);

  if (phaseCtx.imagesPresent) {
    return finalizePick(match.pick, {
      routerVersion: ROUTER_VERSION_LLM,
      rule: match.rule,
      mode: "llm",
      knn: null,
      llm: null,
      phaseCtx,
      context,
      pickSource: "rules",
    });
  }

  // Tier-3 escalation rules win over the classifier (same stack as P1).
  const rulePick = match.pick;
  if (
    (rulePick.kind === "exactTier" && rulePick.tier === 3) ||
    (rulePick.kind === "minTier" && rulePick.minTier === 3)
  ) {
    return finalizePick(rulePick, {
      routerVersion: ROUTER_VERSION_LLM,
      rule: match.rule,
      mode: "llm",
      knn: null,
      llm: null,
      phaseCtx,
      context,
      pickSource: "rules",
    });
  }

  let classification: LlmRouteClassification;

  try {
    classification = await classifyPromptForTier(prompt, context);
    const tier = tierFromLlmClassification(classification);
    const pick = pickSpecFromTier(tier, context);

    return finalizePick(pick, {
      routerVersion: ROUTER_VERSION_LLM,
      rule: "llm_classifier",
      mode: "llm",
      knn: null,
      llm: classification,
      phaseCtx,
      context,
      pickSource: "llm",
    });
  } catch (err) {
    const decision = await finalizePick(match.pick, {
      routerVersion: ROUTER_VERSION_LLM,
      rule: "llm_classifier_fallback_rules",
      mode: "llm",
      knn: null,
      llm: null,
      phaseCtx,
      context,
      pickSource: "rules",
    });
    decision.features.classifierError =
      err instanceof Error ? err.message : String(err);
    return decision;
  }
}

function resolveMode(options?: ResolveRouterOptions): RouterMode {
  if (options?.modeOverride) {
    return options.modeOverride;
  }
  return resolveRouterMode();
}

/**
 * Choose `provider:modelId` for Auto mode.
 * - `model=auto` → `ROUTER_MODE` env (default rules)
 * - `model=auto-llm` → LLM classifier (P3)
 */
export async function resolveRoutedModel(
  prompt: string,
  context: RouterInputContext,
  options?: ResolveRouterOptions,
): Promise<RouterDecision> {
  const mode = resolveMode(options);
  if (mode === "llm") {
    return resolveRoutedModelLlm(prompt, context);
  }
  if (mode === "knn") {
    return resolveRoutedModelKnn(prompt, context);
  }
  if (mode === "hybrid") {
    return resolveRoutedModelHybrid(prompt, context);
  }
  return resolveRoutedModelRules(prompt, context);
}

/** Version string stored on telemetry for the active mode. */
export function activeRouterVersion(mode?: RouterMode): string {
  return routerVersionForMode(mode ?? resolveRouterMode());
}
