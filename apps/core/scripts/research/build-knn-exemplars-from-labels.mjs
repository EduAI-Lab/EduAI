#!/usr/bin/env node
/**
 * Build kNN exemplar file from oracle labels (P3 training data v0).
 *
 * Reads labels JSONL + task-suite prompts; writes apps/core/data/routing-knn-exemplars.json
 * (or RESEARCH_KNN_EXEMPLARS_OUT).
 *
 * Env:
 *   RESEARCH_LABEL_IN       labels JSONL (default labels.v1.jsonl)
 *   RESEARCH_KNN_EXEMPLARS_OUT  output JSON path
 *   RESEARCH_RUN_SPLIT      dev | test | all (default dev — train on dev only)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_LABELS_OUT, PROMPTS_PATH } from "./paths.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${e.message}`);
    }
  });
}

/** Local vLLM stack uses tier 1 + 3; map oracle tier 2 → 3. */
function normalizeTier(tier) {
  if (tier === 1) return 1;
  if (tier === 2 || tier === 3) return 3;
  return null;
}

function main() {
  const labelsPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_LABELS_OUT;
  const outPath =
    readEnv("RESEARCH_KNN_EXEMPLARS_OUT") ??
    resolve(process.cwd(), "data/routing-knn-exemplars.json");
  const splitFilter = (readEnv("RESEARCH_RUN_SPLIT") ?? "dev").toLowerCase();

  const prompts = loadJsonl(PROMPTS_PATH);
  const promptById = new Map(prompts.map((p) => [p.id ?? p.prompt_id, p]));
  const labels = loadJsonl(labelsPath);

  const exemplars = [];
  let skipped = 0;

  for (const label of labels) {
    if (splitFilter !== "all") {
      const meta = promptById.get(label.prompt_id);
      const split = label.split ?? meta?.split;
      if (split && split !== splitFilter) continue;
    }

    const tier = normalizeTier(label.min_adequate_tier);
    if (tier == null) {
      skipped++;
      continue;
    }

    const prompt =
      label.prompt?.trim() ||
      promptById.get(label.prompt_id)?.prompt?.trim() ||
      "";
    if (!prompt) {
      skipped++;
      continue;
    }

    exemplars.push({
      prompt,
      tier,
      tags: [
        label.stratum,
        label.category,
        label.tier_sensitive ? "tier_sensitive" : null,
      ].filter(Boolean),
    });
  }

  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    source_labels: labelsPath,
    split: splitFilter,
    exemplar_count: exemplars.length,
    exemplars,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log("=== build kNN exemplars ===");
  console.log("labels:", labelsPath);
  console.log("split:", splitFilter);
  console.log("exemplars:", exemplars.length);
  console.log("skipped:", skipped);
  console.log("output:", outPath);
  console.log("tier 1:", exemplars.filter((e) => e.tier === 1).length);
  console.log("tier 3:", exemplars.filter((e) => e.tier === 3).length);
}

main();
