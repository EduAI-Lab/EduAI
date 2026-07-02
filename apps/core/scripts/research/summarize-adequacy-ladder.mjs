#!/usr/bin/env node
/**
 * Offline stats for model adequacy ladder runs (32B vs 72B pairing).
 *
 * Env:
 *   RESEARCH_ADEQUACY_72B_IN   default runs/adequacy/adequacy-72b-hard-v1.jsonl
 *   RESEARCH_BOTH_TIER_IN      default both-tier.v1.jsonl
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRunRows } from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, RUNS_DIR } from "./paths.mjs";

function readEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function loadJsonl(path) {
  if (!existsSync(path)) return [];
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

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function main() {
  const adequacyPath = readEnv(
    "RESEARCH_ADEQUACY_72B_IN",
    join(RUNS_DIR, "adequacy", "adequacy-72b-hard-v1.jsonl"),
  );
  const bothTierPath = readEnv("RESEARCH_BOTH_TIER_IN", DEFAULT_BOTH_TIER_IN);

  const adequacy = loadJsonl(adequacyPath);
  const bothTier = loadRunRows(bothTierPath, { dedupe: true });
  const tier3ById = new Map(
    bothTier.filter((r) => r.tier === 3 && r.response).map((r) => [r.prompt_id, r]),
  );

  const errors = adequacy.filter((r) => r.error).length;
  const durs72 = adequacy.filter((r) => r.duration_ms).map((r) => r.duration_ms);
  const durs32 = [];
  let paired = 0;
  let missing32 = 0;

  for (const row of adequacy) {
    const t3 = tier3ById.get(row.prompt_id);
    if (!t3) {
      missing32++;
      continue;
    }
    paired++;
    if (t3.duration_ms) durs32.push(t3.duration_ms);
  }

  const sorted72 = [...durs72].sort((a, b) => a - b);
  const sorted32 = [...durs32].sort((a, b) => a - b);
  const mean = (arr) =>
    arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null;

  console.log("=== adequacy ladder summary ===");
  console.log("72B file:", adequacyPath);
  console.log("both-tier:", bothTierPath);
  console.log("72B rows:", adequacy.length, "errors:", errors);
  console.log("paired with 32B:", paired, "missing 32B:", missing32);
  console.log("");
  console.log("72B latency ms — mean:", mean(durs72), "p50:", percentile(sorted72, 0.5), "p95:", percentile(sorted72, 0.95));
  console.log("32B latency ms — mean:", mean(durs32), "p50:", percentile(sorted32, 0.5), "p95:", percentile(sorted32, 0.95));
  if (mean(durs72) && mean(durs32)) {
    console.log("32B vs 72B mean speedup:", (mean(durs72) / mean(durs32)).toFixed(2) + "x");
  }
}

main();
