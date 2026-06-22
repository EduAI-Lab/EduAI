#!/usr/bin/env node
/**
 * Summarize issue #501 Track B/C JSONL runs into a markdown table.
 *
 * Usage:
 *   node scripts/research/summarize-issue-501.mjs path/to/run.jsonl
 */
import { readFileSync } from "node:fs";
import { summarizeRagRows } from "./research-chat-metrics.mjs";

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
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

function summarizeRows(rows) {
  const ok = rows.filter((r) => !r.error && (r.response || r.http_status === 200));
  const durs = ok.map((r) => r.duration_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const energies = rows
    .map((r) => r.energy_joules)
    .filter((v) => v != null && Number.isFinite(v));
  const joulesPerToken = ok
    .map((r) => r.joules_per_token)
    .filter((v) => v != null && Number.isFinite(v));
  const model =
    rows[0]?.requested_model ?? rows[0]?.routed_model ?? rows[0]?.policy ?? "?";
  const pipeline = rows[0]?.pipeline_label ?? "—";
  const gitSha = rows[0]?.git_sha ?? "—";

  return {
    model,
    pipeline,
    gitSha,
    total: rows.length,
    ok: ok.length,
    errors: rows.length - ok.length,
    okPct: rows.length ? Math.round((ok.length / rows.length) * 100) : 0,
    meanMs: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    p50Ms: percentile(durs, 50),
    p95Ms: percentile(durs, 95),
    meanJoules:
      energies.length
        ? Math.round((energies.reduce((a, b) => a + b, 0) / energies.length) * 100) / 100
        : null,
    totalJoules:
      energies.length ? Math.round(energies.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    meanJoulesPerToken:
      joulesPerToken.length
        ? Math.round((joulesPerToken.reduce((a, b) => a + b, 0) / joulesPerToken.length) * 10000) /
          10000
        : null,
    rag: summarizeRagRows(ok),
  };
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error("Usage: node summarize-issue-501.mjs <run.jsonl> [...]");
  process.exit(1);
}

console.log(
  "| run | pipeline | git | model | OK | mean ms | p50 | p95 | rag inject % | mean sim | mean J | J/tok |",
);
console.log("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

for (const path of paths) {
  const rows = loadJsonl(path);
  const s = summarizeRows(rows);
  const label = path.split(/[/\\]/).pop();
  console.log(
    `| ${label} | ${s.pipeline} | ${s.gitSha} | ${s.model} | ${s.ok}/${s.total} | ${s.meanMs} | ${s.p50Ms} | ${s.p95Ms} | ${s.rag.rag_inject_rate_pct ?? "—"} | ${s.rag.mean_top_similarity ?? "—"} | ${s.meanJoules ?? "—"} | ${s.meanJoulesPerToken ?? "—"} |`,
  );
}

console.log("\n### RAG-grounded subset (category=rag_grounded)\n");
for (const path of paths) {
  const rows = loadJsonl(path).filter((r) => !r.error && r.category === "rag_grounded");
  if (!rows.length) continue;
  const label = path.split(/[/\\]/).pop();
  const durs = rows.map((r) => r.duration_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const rag = summarizeRagRows(rows);
  console.log(
    `- **${label}**: n=${rows.length}, p50=${percentile(durs, 50)} ms, inject=${rag.rag_inject_rate_pct ?? "?"}%, mean_top_sim=${rag.mean_top_similarity ?? "—"}, mean_chunks=${rag.mean_chunk_count ?? "—"}`,
  );
}
