#!/usr/bin/env node
/**
 * Summarize labels.v1.jsonl after LLM-judge labeling.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_LABELS_OUT } from "./paths.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadLabels(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`Line ${i + 1}: ${e.message}`);
    }
  });
}

function main() {
  const path = readEnv("RESEARCH_LABEL_OUT") ?? DEFAULT_LABELS_OUT;
  const rows = loadLabels(path);

  console.log("=== labels summary ===");
  console.log("file:", path);
  console.log("rows:", rows.length);
  console.log("");

  const byMinTier = { 1: 0, 3: 0, null: 0 };
  let tierSensitive = 0;
  let tier3Missing = 0;
  const byStratum = {};
  const byCategory = {};

  for (const row of rows) {
    const key = row.min_adequate_tier == null ? "null" : String(row.min_adequate_tier);
    byMinTier[key] = (byMinTier[key] ?? 0) + 1;
    if (row.tier_sensitive) tierSensitive++;
    if (row.tier3_missing) tier3Missing++;

    const s = row.stratum ?? "?";
    if (!byStratum[s]) byStratum[s] = { n: 0, sensitive: 0, min3: 0 };
    byStratum[s].n++;
    if (row.tier_sensitive) byStratum[s].sensitive++;
    if (row.min_adequate_tier === 3) byStratum[s].min3++;

    const c = row.category ?? "?";
    if (!byCategory[c]) byCategory[c] = { n: 0, sensitive: 0 };
    byCategory[c].n++;
    if (row.tier_sensitive) byCategory[c].sensitive++;
  }

  console.log("min_adequate_tier:", byMinTier);
  console.log("tier_sensitive:", tierSensitive, `(${rows.length ? ((100 * tierSensitive) / rows.length).toFixed(1) : 0}%)`);
  console.log("tier3_missing:", tier3Missing);
  console.log("");

  console.log("By stratum:");
  for (const [s, v] of Object.entries(byStratum).sort()) {
    console.log(`  ${s}: n=${v.n} sensitive=${v.sensitive} min_tier_3=${v.min3}`);
  }

  console.log("");
  console.log("By category:");
  for (const [c, v] of Object.entries(byCategory).sort()) {
    console.log(`  ${c}: n=${v.n} sensitive=${v.sensitive}`);
  }
}

main();
