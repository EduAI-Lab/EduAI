#!/usr/bin/env node
/**
 * Summarize policy runs + oracle gap vs dev labels.
 *
 * RESEARCH_POLICY_OUT — policy JSONL (default policy-runs.v1.jsonl)
 * RESEARCH_LABEL_OUT  — labels JSONL (default labels.v1.jsonl)
 */
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LABELS_OUT, DEFAULT_POLICY_OUT } from "./paths.mjs";

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

function main() {
  const policyPath = readEnv("RESEARCH_POLICY_OUT") ?? DEFAULT_POLICY_OUT;
  const labelsPath = readEnv("RESEARCH_LABEL_OUT") ?? DEFAULT_LABELS_OUT;

  const policies = loadJsonl(policyPath);
  const labels = existsSync(labelsPath) ? loadJsonl(labelsPath) : [];

  console.log("=== policy run summary ===");
  console.log("policy file:", policyPath, "rows:", policies.length);
  console.log("labels file:", labelsPath, "rows:", labels.length);
  console.log("");

  for (const pol of ["P0", "P1", "P3a", "P3b"]) {
    const rows = policies.filter((r) => r.policy === pol && !r.error && r.response);
    if (!rows.length) continue;
    const durs = rows.map((r) => r.duration_ms);
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
    console.log(`${pol}: n=${rows.length} mean_latency_ms=${Math.round(mean)}`);
    if (pol === "P1" || pol === "P3a" || pol === "P3b") {
      const tiers = { 1: 0, 2: 0, 3: 0, null: 0 };
      for (const r of rows) {
        const t = r.routing_tier ?? null;
        tiers[t] = (tiers[t] ?? 0) + 1;
      }
      console.log("  routing_tier:", tiers);
    }
  }

  if (labels.length === 0) return;

  const labelById = new Map(labels.map((l) => [l.prompt_id, l]));
  const p1Dev = policies.filter((r) => r.policy === "P1" && r.split === "dev" && !r.error);
  const p3aDev = policies.filter((r) => r.policy === "P3a" && r.split === "dev" && !r.error);
  const p3bDev = policies.filter((r) => r.policy === "P3b" && r.split === "dev" && !r.error);

  function printOracleGap(label, rows) {
    if (rows.length === 0) {
      console.log(`\nNo ${label} dev runs — skip oracle gap.`);
      return;
    }
    let matched = 0;
    let underRoute = 0;
    let overRoute = 0;
    let correct = 0;

    for (const row of rows) {
      const labelRow = labelById.get(row.prompt_id);
      if (!labelRow || labelRow.min_adequate_tier == null) continue;
      matched++;
      const chosen = row.routing_tier ?? 1;
      const oracle = labelRow.min_adequate_tier;
      if (chosen < oracle) underRoute++;
      else if (chosen > oracle) overRoute++;
      else correct++;
    }

    console.log(`\n=== ${label} vs oracle (dev labels) ===`);
    console.log("matched prompts:", matched);
    console.log("correct tier:", correct, `(${matched ? ((100 * correct) / matched).toFixed(1) : 0}%)`);
    console.log("under-routed (quality risk):", underRoute);
    console.log("over-routed (energy waste):", overRoute);
  }

  if (p1Dev.length === 0 && p3aDev.length === 0 && p3bDev.length === 0) {
    console.log("\nNo P1/P3a/P3b dev runs — skip oracle gap.");
    return;
  }

  printOracleGap("P1", p1Dev);
  printOracleGap("P3a", p3aDev);
  printOracleGap("P3b", p3bDev);

  const sensitive = labels.filter((l) => l.tier_sensitive).length;
  console.log("\n=== label stats ===");
  console.log("tier_sensitive:", sensitive, `/ ${labels.length}`);
  console.log(
    "min_adequate_tier=3:",
    labels.filter((l) => l.min_adequate_tier === 3).length,
  );
}

main();
