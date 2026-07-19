#!/usr/bin/env tsx
/**
 * Offline evaluation: LLM classifier tier predictions vs oracle labels (P3b).
 *
 * Requires vLLM (ROUTING_LLM_CLASSIFIER_MODEL on tier 1).
 *
 * Env:
 *   RESEARCH_LABEL_IN
 *   RESEARCH_LLM_EVAL_SPLIT     dev (default) | test | all
 *   RESEARCH_LLM_EVAL_LIMIT     optional cap
 */
import { readFileSync } from "node:fs";
import {
  classifyPromptForTier,
  tierFromLlmClassification,
} from "~/lib/ai/routing/llm-classifier";
import { DEFAULT_LABELS_OUT } from "./paths.mjs";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path: string): Record<string, unknown>[] {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function normalizeOracleTier(tier: unknown): 1 | 3 | null {
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

  console.log("=== LLM classifier evaluation (P3b) ===");
  console.log("labels:", labelsPath);
  console.log("split:", splitFilter);
  console.log("rows:", labels.length);
  console.log("");

  for (const row of labels) {
    const prompt = String(row.prompt ?? "").trim();
    const oracle = normalizeOracleTier(row.min_adequate_tier);
    if (!prompt || oracle == null) continue;

    try {
      const classification = await classifyPromptForTier(prompt, {
        courseId: null,
        imagesPresent: false,
        courseRagNeeded: row.rag_context === "course",
        ragTopSimilarity: null,
        ragChunkCount: null,
        ragContextTokenEstimate: null,
      });
      const chosen = tierFromLlmClassification(classification);
      const chosenNorm = chosen === 1 ? 1 : 3;
      matched++;

      if (chosenNorm === oracle) correct++;
      else if (chosenNorm < oracle) underRoute++;
      else overRoute++;

      if (row.tier_sensitive) {
        const mark = chosenNorm === oracle ? "OK" : "MISS";
        console.log(
          `  [${mark}] ${row.prompt_id} oracle=${oracle} llm=${chosenNorm} ` +
            `complexity=${classification.complexity} conf=${classification.confidence}`,
        );
      }
    } catch (err) {
      errors++;
      console.log(
        `  [ERR] ${row.prompt_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
