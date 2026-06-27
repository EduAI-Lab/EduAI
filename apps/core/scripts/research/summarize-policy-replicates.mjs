#!/usr/bin/env node
/**
 * Mean ± std for policy runs with RESEARCH_REPLICATE > 1.
 *
 * Groups by policy, aggregates per-replicate totals/means, then reports spread.
 *
 * Usage: node summarize-policy-replicates.mjs /path/to/policy-runs.jsonl
 */
import { readFileSync } from "node:fs";
import { rowMatchesPolicy } from "./policy-ids.mjs";

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

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function fmt(n, digits = 1) {
  return Number(n).toFixed(digits);
}

function summarizePolicyReplicates(rows, policy) {
  const ok = rows.filter(
    (r) => rowMatchesPolicy(r, policy) && r.http_status === 200 && !r.error,
  );
  if (!ok.length) return null;

  const reps = [...new Set(ok.map((r) => r.replicate ?? 1))].sort((a, b) => a - b);
  const repStats = reps.map((rep) => {
    const rr = ok.filter((r) => (r.replicate ?? 1) === rep);
    const durs = rr.map((r) => r.duration_ms);
    const en = rr.filter((r) => r.energy_joules != null);
    const sumJ = en.reduce((s, r) => s + r.energy_joules, 0);
    return {
      rep,
      n: rr.length,
      mean_ms: mean(durs),
      total_j: sumJ,
      mean_j: en.length ? sumJ / en.length : 0,
    };
  });

  return {
    policy,
    replicates: reps.length,
    prompts_per_rep: repStats[0]?.n ?? 0,
    mean_latency_ms: mean(repStats.map((r) => r.mean_ms)),
    std_latency_ms: std(repStats.map((r) => r.mean_ms)),
    mean_total_j: mean(repStats.map((r) => r.total_j)),
    std_total_j: std(repStats.map((r) => r.total_j)),
    mean_j_per_request: mean(repStats.map((r) => r.mean_j)),
    std_j_per_request: std(repStats.map((r) => r.mean_j)),
    per_replicate: repStats,
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node summarize-policy-replicates.mjs <policy-runs.jsonl>");
    process.exit(1);
  }

  const rows = loadJsonl(path);
  console.log("=== policy replicate summary ===");
  console.log("file:", path);
  console.log("rows:", rows.length);
  console.log("");

  const results = [];
  for (const pol of ["P0", "P1", "P2", "P3"]) {
    const s = summarizePolicyReplicates(rows, pol);
    if (!s) continue;
    results.push(s);
    console.log(`${pol} (${s.replicates} replicates × ${s.prompts_per_rep} prompts):`);
    console.log(
      `  mean latency: ${Math.round(s.mean_latency_ms)} ± ${Math.round(s.std_latency_ms)} ms`,
    );
    console.log(
      `  total energy: ${fmt(s.mean_total_j, 0)} ± ${fmt(s.std_total_j, 0)} J`,
    );
    console.log(
      `  mean J/request: ${fmt(s.mean_j_per_request, 1)} ± ${fmt(s.std_j_per_request, 1)} J`,
    );
    for (const r of s.per_replicate) {
      console.log(
        `    rep ${r.rep}: mean=${Math.round(r.mean_ms)} ms total=${fmt(r.total_j, 0)} J n=${r.n}`,
      );
    }
    console.log("");
  }

  const p0 = results.find((r) => r.policy === "P0");
  const p1 = results.find((r) => r.policy === "P1");
  if (p0 && p1) {
    const latPct =
      p0.mean_latency_ms > 0
        ? ((1 - p1.mean_latency_ms / p0.mean_latency_ms) * 100).toFixed(1)
        : "?";
    const enPct =
      p0.mean_total_j > 0
        ? ((1 - p1.mean_total_j / p0.mean_total_j) * 100).toFixed(1)
        : "?";
    console.log("=== P1 vs P0 (replicate means) ===");
    console.log(
      `latency: ${Math.round(p1.mean_latency_ms)} ± ${Math.round(p1.std_latency_ms)} ms vs ${Math.round(p0.mean_latency_ms)} ± ${Math.round(p0.std_latency_ms)} ms (${latPct}% lower for P1)`,
    );
    console.log(
      `total energy: ${fmt(p1.mean_total_j, 0)} ± ${fmt(p1.std_total_j, 0)} J vs ${fmt(p0.mean_total_j, 0)} ± ${fmt(p0.std_total_j, 0)} J (${enPct}% less for P1)`,
    );
  }
}

main();
