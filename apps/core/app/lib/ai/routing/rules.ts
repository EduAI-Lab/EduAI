/**
 * Phase 1 routing rules — pure predicates and ordering (no DB, no I/O).
 *
 * Given a **`Phase1RouterContext`** (prompt text, attachments flag, optional RAG stats),
 * **`matchPhase1Rules`** returns the first matching rule and a **`PickSpec`** telling **`tiers.ts`** how to choose a model.
 *
 * Rule order: images → short factual → strong RAG → long RAG → default.
 * External web search is out of scope — no tool/web-lookup routing rule.
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
};

export type Phase1RuleMatch = {
  /** Stable id for telemetry / training (e.g. `rule3_short_factual`). */
  rule: string;
  pick: PickSpec;
};

const SHORT_FACTUAL_PREFIXES = ["what is", "define", "who is", "when did"] as const;

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

/**
 * Phase 1 rule stack. First match wins.
 *
 * 1. Images → tier ≥ 2, `supportsImages`
 * 2. Short factual → Tier 1
 * 3. Strong RAG (top-1 similarity > 0.8 && ≤ 2 chunks) → Tier 1
 * 4. Long RAG (≥ 4 chunks && estimated context > 2k tokens) → Tier 2, lowest carbon
 * 5. Default → Tier 2, lowest carbon
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

  if (isShortFactualPrompt(prompt, lower)) {
    return {
      rule: "rule3_short_factual_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const top1 = ctx.ragTopSimilarity;
  const chunks = ctx.ragChunkCount;
  if (
    top1 != null &&
    chunks != null &&
    top1 > 0.8 &&
    chunks <= 2
  ) {
    return {
      rule: "rule4_strong_rag_tier_1",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    };
  }

  const ctxTok = ctx.ragContextTokenEstimate;
  if (
    chunks != null &&
    ctxTok != null &&
    chunks >= 4 &&
    ctxTok > 2000
  ) {
    return {
      rule: "rule5_long_rag_tier_2_carbon",
      pick: { kind: "exactTier", tier: 2, tieBreak: "carbon" },
    };
  }

  return {
    rule: "rule6_default_tier_2_carbon",
    pick: { kind: "exactTier", tier: 2, tieBreak: "carbon" },
  };
}
