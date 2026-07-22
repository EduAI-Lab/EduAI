#!/usr/bin/env node
/**
 * perf-compare.mjs — diff two perf-baseline response-times.json files (before vs after).
 *
 * Usage:
 *   node scripts/perf-compare.mjs <before.json> <after.json> [--md]
 *
 * Joins by app+method+path and reports p50/p95/p99 + payload deltas. Compare like-for-like
 * only: same target environment + same seed (check the `env` block in each file).
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/perf-compare.mjs <before.json> <after.json> [--md]");
  process.exit(1);
}
const asMd = rest.includes("--md");
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const key = (r) => `${r.app} ${r.method} ${r.path}`;
const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
const bMap = new Map(before.results.map((r) => [key(r), r]));
const rows = [];
for (const a of after.results) {
  const b = bMap.get(key(a));
  if (!b) continue;
  const d = (metric) => {
    const bv = b.latency_ms[metric], av = a.latency_ms[metric];
    if (bv == null || av == null) return { before: bv, after: av, delta: null, pct: null };
    return { before: bv, after: av, delta: round(av - bv), pct: bv ? round(((av - bv) / bv) * 100) : null };
  };
  rows.push({ key: key(a), p50: d("p50"), p95: d("p95"), p99: d("p99"),
    bytes: { before: b.payload_bytes.avg, after: a.payload_bytes.avg } });
}

rows.sort((x, y) => (y.p95.delta ?? 0) - (x.p95.delta ?? 0)); // biggest regressions first

if (asMd) {
  console.log(`# Perf delta — ${before.env?.target_label} @ ${before.env?.git_sha} → ${after.env?.git_sha}\n`);
  console.log("| App/Endpoint | p50 (b→a) | p95 (b→a) | p99 (b→a) | p95 Δ% |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.key} | ${r.p50.before}→${r.p50.after} | ${r.p95.before}→${r.p95.after} | ${r.p99.before}→${r.p99.after} | ${fmtPct(r.p95.pct)} |`);
  }
} else {
  for (const r of rows) {
    console.log(`${r.key.padEnd(50)} p95 ${String(r.p95.before).padStart(7)}→${String(r.p95.after).padStart(7)}ms (${fmtPct(r.p95.pct)})`);
  }
}
function fmtPct(p) { return p == null ? "n/a" : `${p > 0 ? "+" : ""}${p}%`; }
