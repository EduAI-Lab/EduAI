#!/usr/bin/env tsx
/**
 * Offline evaluation: kNN tier predictions vs oracle labels (P3 v0).
 *
 * Requires embedding API (Ollama local or OPENAI_API_KEY) — same as RAG embed path.
 *
 * Env:
 *   RESEARCH_LABEL_IN
 *   ROUTING_KNN_EXEMPLARS_PATH  → apps/core/data/routing-knn-exemplars.json
 *   ROUTING_KNN_K               default 5
 *   ROUTING_KNN_MIN_SIM         default 0.55
 *   RESEARCH_KNN_EVAL_SPLIT     dev (default) | test | all
 *   RESEARCH_KNN_LEAVE_ONE_OUT  1 → exclude self prompt from neighbor vote
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  invalidateKnnExemplarCache,
  predictTierKnn,
  voteTierFromNeighbors,
  loadCachedKnnExemplars,
  parseKnnK,
  parseKnnMinSimilarity,
} from "~/lib/ai/routing/knn";
import { generateEmbedding } from "~/lib/ai/embedding";
import { cosineSimilarity } from "~/lib/ai/routing/cosine";
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

async function predictLeaveOneOut(
  prompt: string,
  exemplarPath: string,
  k: number,
  minSim: number,
): Promise<{ tier: 1 | 2 | 3; confidence: number }> {
  const exemplars = await loadCachedKnnExemplars(exemplarPath);
  const trimmed = prompt.trim();
  const pool = exemplars.filter((ex) => ex.prompt !== trimmed);
  const queryEmbedding = await generateEmbedding(trimmed);

  const ranked = pool
    .map((ex) => ({
      prompt: ex.prompt,
      tier: ex.tier,
      similarity: cosineSimilarity(queryEmbedding, ex.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  const { tier, confidence } = voteTierFromNeighbors(ranked);
  return {
    tier: confidence >= minSim ? tier : 2,
    confidence,
  };
}

async function main() {
  const labelsPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_LABELS_OUT;
  const exemplarPath =
    readEnv("ROUTING_KNN_EXEMPLARS_PATH") ??
    resolve(process.cwd(), "data/routing-knn-exemplars.json");
  const splitFilter = (readEnv("RESEARCH_KNN_EVAL_SPLIT") ?? "dev").toLowerCase();
  const leaveOneOut = readEnv("RESEARCH_KNN_LEAVE_ONE_OUT") === "1";
  const k = parseKnnK(process.env.ROUTING_KNN_K);
  const minSim = parseKnnMinSimilarity(process.env.ROUTING_KNN_MIN_SIM);

  invalidateKnnExemplarCache();

  const labels = loadJsonl(labelsPath).filter((row) => {
    if (splitFilter === "all") return true;
    return String(row.split ?? "") === splitFilter;
  });

  let matched = 0;
  let correct = 0;
  let underRoute = 0;
  let overRoute = 0;
  const confidences: number[] = [];

  console.log("=== kNN router evaluation (P3 v0) ===");
  console.log("labels:", labelsPath);
  console.log("exemplars:", exemplarPath);
  console.log("split:", splitFilter);
  console.log("k:", k, "min_sim:", minSim);
  console.log("leave_one_out:", leaveOneOut);
  console.log("rows:", labels.length);
  console.log("");

  for (const row of labels) {
    const prompt = String(row.prompt ?? "").trim();
    const oracle = normalizeOracleTier(row.min_adequate_tier);
    if (!prompt || oracle == null) continue;

    const pred = leaveOneOut
      ? await predictLeaveOneOut(prompt, exemplarPath, k, minSim)
      : await predictTierKnn(prompt, { k, minSimilarity: minSim, exemplarPath });

    const chosen = pred.tier === 1 ? 1 : 3;
    matched++;
    confidences.push(pred.confidence);

    if (chosen === oracle) correct++;
    else if (chosen < oracle) underRoute++;
    else overRoute++;

    if (row.tier_sensitive) {
      const mark = chosen === oracle ? "OK" : "MISS";
      console.log(
        `  [${mark}] ${row.prompt_id} oracle=${oracle} knn=${chosen} conf=${pred.confidence.toFixed(3)}`,
      );
    }
  }

  const meanConf =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

  console.log("");
  console.log("matched:", matched);
  console.log(
    "correct tier:",
    correct,
    `(${matched ? ((100 * correct) / matched).toFixed(1) : 0}%)`,
  );
  console.log("under-routed (quality risk):", underRoute);
  console.log("over-routed (energy waste):", overRoute);
  console.log("mean neighbor confidence:", meanConf.toFixed(3));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
