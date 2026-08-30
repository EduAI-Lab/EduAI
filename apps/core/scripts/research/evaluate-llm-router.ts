#!/usr/bin/env tsx
/**
 * Offline evaluation: LLM classifier tier predictions vs oracle labels (P3b).
 *
 * Requires vLLM (ROUTING_LLM_CLASSIFIER_MODEL on tier 1).
 *
 * Replicates production's rules-then-classifier pre-gate
 * (resolveRoutedModelLlm in router.ts): rules run first, and a rule that
 * escalates to tier 3 wins outright without ever calling the classifier.
 * The classifier is only consulted for prompts rules left un-escalated, and
 * it can still under-route or over-route those prompts relative to the
 * oracle labels. Prior
 * to this fix the harness called the classifier standalone, bypassing the
 * rules pre-gate entirely — its numbers did not describe deployed behavior
 * (see the 2026-08 "auto-llm tier drift" investigation).
 *
 * rag_context in the label pool is a strength category ("strong" | "weak" |
 * "none"), not the numeric rag_top_similarity / rag_chunk_count
 * tierFromLlmClassification's RAG-aware branch expects. Rather than
 * fabricate numeric values the label pool doesn't provide, "strong" is
 * mapped to a representative strong-similarity point (see
 * RAG_CONTEXT_PROXY below) and "weak"/"none" are left unset (no RAG
 * de-escalation applied) — a documented approximation, not a claim of
 * measured retrieval strength.
 *
 * Env:
 *   RESEARCH_LABEL_IN
 *   RESEARCH_LLM_EVAL_SPLIT     dev (default) | test | all
 *   RESEARCH_LLM_EVAL_LIMIT     optional cap
 */
import type { JsonObject, JsonValue } from "~/lib/json-value";
import { readFileSync } from "node:fs";
import { classifyPromptForTier, tierFromLlmClassification } from "~/lib/ai/routing/llm-classifier";
import { matchPhase1Rules } from "~/lib/ai/routing/rules";
import { DEFAULT_LABELS_OUT } from "./paths.mjs";

/** Representative rag_top_similarity/rag_chunk_count for a "strong" rag_context
 * label — matches the rule stack's own routingRagStrongSimilarity() default
 * (0.8) with headroom, since the label pool doesn't record the real value. */
type RagContextProxy = { ragTopSimilarity: number; ragChunkCount: number };

const RAG_CONTEXT_PROXY = new Map<string, RagContextProxy | null>([
  ["strong", { ragTopSimilarity: 0.85, ragChunkCount: 3 }],
  ["weak", null],
  ["none", null],
]);

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path: string): JsonObject[] {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line) as JsonObject;
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function normalizeOracleTier(tier: JsonValue | undefined): 1 | 3 | null {
  if (tier === 1) return 1;
  if (tier === 2 || tier === 3) return 3;
  return null;
}

async function main() {
  const labelsPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_LABELS_OUT;
  const splitFilter = (readEnv("RESEARCH_LLM_EVAL_SPLIT") ?? "dev").toLowerCase();
  const limitRaw = readEnv("RESEARCH_LLM_EVAL_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;

  let labels = loadJsonl(labelsPath).filter((row) => {
    if (splitFilter === "all") return true;
    return String(row.split ?? "") === splitFilter;
  });
  if (limit) {
    labels = labels.slice(0, limit);
  }

  let matched = 0;
  let correct = 0;
  let underRoute = 0;
  let overRoute = 0;
  let errors = 0;
  let rulesGated = 0; // rules escalated to tier 3 before the classifier ran

  console.log("=== LLM classifier evaluation (P3b) ===");
  console.log("labels:", labelsPath);
  console.log("split:", splitFilter);
  console.log("rows:", labels.length);
  console.log("note: replicates production's rules-then-classifier pre-gate; rows the");
  console.log("rule stack already escalates never reach the classifier (see header).");
  console.log("");

  for (const row of labels) {
    const prompt = String(row.prompt ?? "").trim();
    const oracle = normalizeOracleTier(row.min_adequate_tier);
    if (!prompt || oracle == null) continue;

    const ragContextKey = String(row.rag_context ?? "none");
    const ragProxy = RAG_CONTEXT_PROXY.get(ragContextKey) ?? null;
    const courseRagNeeded = ragContextKey !== "none";

    try {
      // Production routing (resolveRoutedModelLlm, router.ts): rules run
      // first, and only a tier-3 rule wins outright without consulting the
      // classifier. Exact tier-1 picks continue through the classifier.
      //
      // courseId is always null here (the label pool has no real course
      // session attached to each prompt), so rule3b_course_rag_tier_1
      // (which fires on ctx.courseId && ctx.courseRagNeeded alone, no
      // numeric RAG fields required) can never match in this harness even
      // though courseRagNeeded is now true for "weak"/"strong" rows. In
      // In production, this may select an exact-tier-1 rule pick, but that pick still
      // proceeds to the classifier; here it instead falls through to
      // rule4/rule4b (numeric RAG check) or the classifier. Both paths
      // converge on tier 1 for strong-RAG rows anyway, so the practical
      // effect on these metrics is expected to be small, but this is a known,
      // documented gap between this harness and production for course-scoped
      // requests — fabricating a courseId would be worse, since the label
      // pool doesn't record a real one.
      const ruleMatch = matchPhase1Rules({
        prompt,
        courseId: null,
        ragTopSimilarity: ragProxy?.ragTopSimilarity ?? null,
        ragChunkCount: ragProxy?.ragChunkCount ?? null,
        courseRagNeeded,
      });
      const rulePick = ruleMatch.pick;
      const ruleEscalates =
        (rulePick.kind === "exactTier" && rulePick.tier === 3) ||
        (rulePick.kind === "minTier" && rulePick.minTier === 3);

      let chosenNorm: 1 | 3;
      let complexityLabel = "n/a (rules pre-gate)";
      let confidenceLabel = "n/a";

      if (ruleEscalates) {
        rulesGated++;
        chosenNorm = 3;
      } else {
        const classification = await classifyPromptForTier(prompt, {
          courseId: null,
          imagesPresent: false,
          courseRagNeeded,
          ragTopSimilarity: ragProxy?.ragTopSimilarity ?? null,
          ragChunkCount: ragProxy?.ragChunkCount ?? null,
          ragContextTokenEstimate: null,
        });
        const chosen = tierFromLlmClassification(classification, {
          ragTopSimilarity: ragProxy?.ragTopSimilarity,
          ragChunkCount: ragProxy?.ragChunkCount,
        });
        chosenNorm = chosen === 1 ? 1 : 3;
        complexityLabel = classification.complexity;
        confidenceLabel = String(classification.confidence);
      }

      matched++;
      if (chosenNorm === oracle) correct++;
      else if (chosenNorm < oracle) underRoute++;
      else overRoute++;

      if (row.tier_sensitive) {
        const mark = chosenNorm === oracle ? "OK" : "MISS";
        console.log(
          `  [${mark}] ${row.prompt_id} oracle=${oracle} chosen=${chosenNorm} ` +
            `complexity=${complexityLabel} conf=${confidenceLabel} ` +
            `rule=${ruleEscalates ? ruleMatch.rule : "(classifier)"}`,
        );
      }
    } catch (err) {
      errors++;
      console.log(`  [ERR] ${row.prompt_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("");
  console.log("matched:", matched);
  console.log(
    "correct tier:",
    correct,
    `(${matched ? ((100 * correct) / matched).toFixed(1) : 0}%)`,
  );
  console.log("under-routed (quality risk):", underRoute);
  console.log("over-routed (energy waste):", overRoute);
  console.log("classifier errors:", errors);
  console.log(
    "rules-gated (escalated before classifier ran):",
    rulesGated,
    `(${matched ? ((100 * rulesGated) / matched).toFixed(1) : 0}%)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
