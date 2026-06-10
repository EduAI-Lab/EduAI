#!/usr/bin/env node
/**
 * Aggregate multiple classroom-sim summary .txt files (mean ± std).
 *
 * Usage:
 *   node summarize-classroom-replicates.mjs /path/to/classroom-p1-r*.txt
 * Or RESEARCH_CLASSROOM_REPLICATE_GLOB via env + paths in RUNS_DIR
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CLASSROOM_SUMMARY, RUNS_DIR } from "./paths.mjs";

function parseSummary(text) {
  const get = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  const num = (re) => {
    const v = get(re);
    return v != null ? Number(v) : NaN;
  };
  return {
    policy: get(/policy:\s*(\S+)/),
    students: num(/students:\s*(\d+)/),
    concurrency: num(/concurrency:\s*(\d+)/),
    wall_time_ms: num(/wall_time_ms:\s*(\d+)/),
    ok: get(/OK:\s*([\d/]+)/),
    mean: num(/mean:\s*(\d+)/),
    p50: num(/p50:\s*(\d+)/),
    p95: num(/p95:\s*(\d+)/),
    max: num(/max:\s*(\d+)/),
    tier1: num(/tier1=(\d+)/),
    tier3: num(/tier3=(\d+)/),
  };
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function fmtMs(v) {
  return Math.round(v);
}

function aggregateGroup(label, rows) {
  const means = rows.map((r) => r.mean).filter(Number.isFinite);
  const p50s = rows.map((r) => r.p50).filter(Number.isFinite);
  const p95s = rows.map((r) => r.p95).filter(Number.isFinite);
  const walls = rows.map((r) => r.wall_time_ms).filter(Number.isFinite);

  const lines = [
    `${label} (n=${rows.length} runs):`,
    `  mean latency: ${fmtMs(mean(means))} ± ${fmtMs(std(means))} ms`,
    `  p50:          ${fmtMs(mean(p50s))} ± ${fmtMs(std(p50s))} ms`,
    `  p95:          ${fmtMs(mean(p95s))} ± ${fmtMs(std(p95s))} ms`,
    `  wall time:    ${fmtMs(mean(walls))} ± ${fmtMs(std(walls))} ms`,
    `  per-run mean: [${means.map(fmtMs).join(", ")}]`,
    `  per-run p95:  [${p95s.map(fmtMs).join(", ")}]`,
  ];
  if (rows[0]?.tier1 != null) {
    const t1 = rows.map((r) => r.tier1).filter(Number.isFinite);
    const t3 = rows.map((r) => r.tier3).filter(Number.isFinite);
    lines.push(`  tier1/tier3 (mean): ${mean(t1).toFixed(1)} / ${mean(t3).toFixed(1)}`);
  }
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const runsDir = process.env.RESEARCH_RUNS_DIR?.trim() || RUNS_DIR;

  let p1Files = args.filter((f) => f.includes("p1") || f.includes("P1"));
  let p0Files = args.filter((f) => f.includes("p0") || f.includes("P0"));

  if (p1Files.length === 0) {
    p1Files = globSync(join(runsDir, "classroom-sim-p1-r*.txt"));
  }
  if (p0Files.length === 0) {
    p0Files = globSync(join(runsDir, "classroom-sim-p0-r*.txt"));
  }

  const load = (files) =>
    files
      .sort()
      .map((f) => ({ file: f, ...parseSummary(readFileSync(f, "utf8")) }));

  const p1 = load(p1Files);
  const p0 = load(p0Files);

  const outPath =
    process.env.RESEARCH_CLASSROOM_REPLICATE_SUMMARY ||
    join(runsDir, "classroom-sim-replicates-summary.txt");

  const lines = [
    "=== Classroom simulation replicates ===",
    `Generated: ${new Date().toISOString()}`,
    `runs dir: ${runsDir}`,
    "",
  ];

  if (p1.length) {
    lines.push(aggregateGroup("P1 (auto)", p1));
    lines.push("");
  } else {
    lines.push("P1: no replicate summary files found");
    lines.push("");
  }

  if (p0.length) {
    lines.push(aggregateGroup("P0 (always 32B)", p0));
    lines.push("");
  } else {
    lines.push("P0: no replicate summary files found");
    lines.push("");
  }

  if (p1.length && p0.length) {
    const p1m = mean(p1.map((r) => r.mean));
    const p0m = mean(p0.map((r) => r.mean));
    lines.push(
      `Mean latency P1 vs P0 (across replicate means): ${fmtMs(p1m)} vs ${fmtMs(p0m)} (${(((p0m - p1m) / p0m) * 100).toFixed(1)}% lower for P1)`,
    );
  }

  const text = `${lines.join("\n")}\n`;
  writeFileSync(outPath, text, "utf8");
  console.log(text);
  console.log("written:", outPath);
}

main();
