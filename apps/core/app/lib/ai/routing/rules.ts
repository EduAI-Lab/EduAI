/**
 * Phase 1 routing rules — pure predicates and ordering (no DB, no I/O).
 *
 * Given a **`Phase1RouterContext`** (prompt text, attachments flag, optional RAG stats),
 * **`matchPhase1Rules`** returns the first matching rule and a **`PickSpec`** telling **`tiers.ts`** how to choose a model.
 *
 * Rule order: images → escalation (debug/complex/RAG-reasoning/enumeration) → short factual → RAG tier-1 → long RAG → default.
 *
 * **Frozen 2026-06-27** for Paper 1 held-out evaluation — no further dev-suite rule tuning.
 *
 * **Web-lookup rule retired 2026-08-04** (PREREG_v3.md §7, RULE_STACK_v3.md):
 * the live-web-lookup escalation rule pointed at a Firecrawl-backed tool
 * capability that (a) is not currently deployed/managed as a routed
 * feature and (b) is explicitly out of scope for this study — PREREG §3.3
 * excludes all live-web/tool prompts at authoring time, and confirmed via
 * direct check that zero of the 212 v3 suite prompts have web-lookup
 * phrasing (`tools_expected: "none"` on all 212 by design). Same
 * disposition as the images rule: structurally dead, not under-tested.
 * Removes 3 v2 (`ts-###`) test fixtures that previously exercised this
 * rule — a disclosed regression against v2's labeled set, acceptable since
 * PREREG treats v2 as pilot/design-input only, never a co-equal result.
 */
import type { PickSpec } from "./tiers";

export type Phase1RouterContext = {
  prompt: string;
  imagesPresent: boolean;
  courseId: string | null;
  /** Top-1 cosine similarity from pgvector retrieval (same scale as `findRelevantContent`). */
  ragTopSimilarity?: number | null;
  /** Number of chunks returned / used for this turn’s RAG context. */
  ragChunkCount?: number | null;
  /** Rough token estimate for merged RAG context (e.g. chars/4); used for “long context” rule. */
  ragContextTokenEstimate?: number | null;
  /** True when chat intent decided course-material RAG should run (see `needsCourseRag`). */
  courseRagNeeded?: boolean;
};

export type Phase1RuleMatch = {
  /** Stable id for telemetry / training (e.g. `rule3_short_factual`). */
  rule: string;
  pick: PickSpec;
};

const SHORT_FACTUAL_PREFIXES = [
  "what is",
  "define",
  "who is",
  "when did",
  "who won",
  "what was",
  "where was",
  "when was",
] as const;

const TIER_3_ESCALATION_PICK: PickSpec = {
  kind: "exactTier",
  tier: 3,
  tieBreak: "carbon",
};

const DEBUG_PATTERN = /\bdebug this code\b|\bwhy might the loop\b/i;

const COMPLEX_REASONING_PATTERN =
  /\bwalk through.{0,60}\b(algorithm|partition|graph|quicksort|dijkstra|substitution)\b/i;

const COMPLEX_CODE_PATTERN =
  /\bwrite a\b.{0,40}\bfunction\b.{0,40}\b(iteratively|recursively)\b/i;

const REFACTOR_USE_EFFECT_PATTERN =
  /\buseeffect\b[\s\S]{0,120}\boutline a refactor\b|\boutline a refactor\b[\s\S]{0,120}\buseeffect\b/i;

const RAG_REASONING_PATTERN =
  /\bwhich factor was not\b|\bnot a driver\b|\bgive an example that violates\b/i;

/** Multi-item enumeration from course RAG (tier-sensitive; e.g. ts-080). */
const DISTINCT_ENUMERATION_PATTERN =
  /\b(name|list|give|identify)\b.{0,40}\b(two|2|three|3)\b.{0,40}\bdistinct\b/i;

function routingRagStrongSimilarity(): number {
  const raw = process.env.ROUTING_RAG_STRONG_SIM;
  if (raw === undefined || raw === "") return 0.8;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.8;
}

function routingRagTier1Similarity(): number {
  const raw = process.env.ROUTING_RAG_TIER1_SIM;
  if (raw === undefined || raw === "") return 0.55;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.55;
}

/** Default Auto tier when no escalation rule matches. `1` = prefer 7B (sustainability default). */
export function routingDefaultTier(): 1 | 2 {
  const raw = process.env.ROUTING_DEFAULT_TIER?.trim();
  if (raw === "2") return 2;
  return 1;
}

function defaultTierPick(): PickSpec {
  const tier = routingDefaultTier();
  return {
    kind: "exactTier",
    tier,
    tieBreak: tier === 1 ? "energy" : "carbon",
  };
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Rule 3: short factual (< 120 chars) opening phrase. */
export function isShortFactualPrompt(prompt: string, lower: string): boolean {
  if (prompt.length >= 120) {
    return false;
  }
  return SHORT_FACTUAL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Debugging prompts where 7B often mis-explains control flow. */
export function isDebugEscalationPrompt(lower: string): boolean {
  return DEBUG_PATTERN.test(lower);
}

/** Multi-step code / algorithm tasks that strict oracle rated tier-3 only. */
export function isComplexReasoningPrompt(prompt: string, lower: string): boolean {
  if (COMPLEX_REASONING_PATTERN.test(lower)) return true;
  if (COMPLEX_CODE_PATTERN.test(lower)) return true;
  if (REFACTOR_USE_EFFECT_PATTERN.test(lower)) return true;
  if (/\bpartition step of quicksort\b/i.test(lower)) return true;
  return false;
}

/** Strong-RAG hits that still need tier 3 for reasoning quality (not retrieval alone). */
export function needsRagReasoningEscalation(lower: string): boolean {
  return (
    RAG_REASONING_PATTERN.test(lower) ||
    COMPLEX_REASONING_PATTERN.test(lower)
  );
}

/** Course RAG prompts asking for multiple distinct items — 7B often under-lists. */
export function needsDistinctEnumerationEscalation(lower: string): boolean {
  return DISTINCT_ENUMERATION_PATTERN.test(lower);
}

function hasStrongRagHit(ctx: Phase1RouterContext): boolean {
  const top1 = ctx.ragTopSimilarity;
  const chunks = ctx.ragChunkCount;
  return top1 != null && chunks != null && chunks >= 1 && top1 >= routingRagStrongSimilarity();
}

/**
 * Phase 1 rule stack. First match wins.
 *
 * 1. Images → tier ≥ 2
 * 2b. Debug → tier 3
 * 2c. Complex reasoning / code → tier 3
 * 2d. RAG-reasoning phrasing → tier 3 (before RAG tier-1 shortcuts)
 * 2e. Distinct multi-item enumeration → tier 3 (tier-sensitive RAG, e.g. ts-080)
 * 3. Short factual → tier 1
 * 3b. Course RAG → tier 1
 * 4c. Strong RAG + reasoning escalation → tier 3 (legacy; rule2d covers pattern-only)
 * 4. Strong RAG → tier 1
 * 4b. Moderate RAG → tier 1
 * 5. Long RAG → default tier
 * 6. Default → default tier (usually 1 / 7B)
 */
export function matchPhase1Rules(ctx: Phase1RouterContext): Phase1RuleMatch {
  const prompt = normalizeWhitespace(ctx.prompt);
  const lower = prompt.toLowerCase();

  if (ctx.imagesPresent) {
    return {
      rule: "rule1_images_tier_ge_2",
      pick: {
        kind: "minTier",
        minTier: 2,
        requireImages: true,
        tieBreak: "energy",
      },
    };
  }

  if (isDebugEscalationPrompt(lower)) {
    return { rule: "rule2b_debug_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (isComplexReasoningPrompt(prompt, lower)) {
    return { rule: "rule2c_complex_task_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (needsRagReasoningEscalation(lower)) {
    return { rule: "rule2d_rag_reasoning_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (needsDistinctEnumerationEscalation(lower)) {
    return { rule: "rule2e_distinct_enumeration_tier_3", pick: TIER_3_ESCALATION_PICK };
  }

  if (isShortFactualPrompt(prompt, lower)) {
    return {
      rule: "rule3_short_factual_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const top1 = ctx.ragTopSimilarity;
  const chunks = ctx.ragChunkCount;

  if (ctx.courseId && ctx.courseRagNeeded) {
    return {
      rule: "rule3b_course_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  if (hasStrongRagHit(ctx)) {
    return {
      rule: "rule4_strong_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  if (
    ctx.courseId &&
    top1 != null &&
    chunks != null &&
    chunks >= 1 &&
    top1 >= routingRagTier1Similarity()
  ) {
    return {
      rule: "rule4b_moderate_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const ctxTok = ctx.ragContextTokenEstimate;
  if (chunks != null && ctxTok != null && chunks >= 4 && ctxTok > 2000) {
    const tier = routingDefaultTier();
    return {
      rule: tier === 1 ? "rule5_long_rag_tier_1_energy" : "rule5_long_rag_tier_2_carbon",
      pick: defaultTierPick(),
    };
  }

  const tier = routingDefaultTier();
  return {
    rule: tier === 1 ? "rule6_default_tier_1_energy" : "rule6_default_tier_2_carbon",
    pick: defaultTierPick(),
  };
}
