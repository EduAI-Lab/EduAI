#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const RUNS = process.argv[2] || "/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs";
const STAMP_P0 = process.argv[3] || "20260626T022338Z";
const STAMP_P2P3 = process.argv[4] || "20260626T032025Z";

function loadJsonl(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

function summarizePolicy(rows, policy) {
  const pr = rows.filter((r) => r.policy === policy && !r.error);
  const ok = pr.filter((r) => r.http_status === 200);
  const durs = ok.map((r) => r.duration_ms);
  const en = ok.filter((r) => r.energy_joules != null);
  const sumJ = en.reduce((s, r) => s + (r.energy_joules || 0), 0);
  const tok = ok.filter((r) => r.prompt_tokens != null && r.completion_tokens != null);
  const sumIn = tok.reduce((s, r) => s + r.prompt_tokens, 0);
  const sumOut = tok.reduce((s, r) => s + r.completion_tokens, 0);
  const tiers = { 1: 0, 2: 0, 3: 0, null: 0 };
  for (const r of ok) tiers[r.routing_tier ?? null] = (tiers[r.routing_tier ?? null] ?? 0) + 1;
  return {
    policy,
    rows: pr.length,
    ok: ok.length,
    errors: pr.length - ok.length,
    mean_ms: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    p50_ms: durs.length ? durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)] : 0,
    total_j: Math.round(sumJ * 100) / 100,
    mean_j: en.length ? Math.round((sumJ / en.length) * 100) / 100 : 0,
    with_tokens: tok.length,
    mean_j_per_1k_out:
      sumOut > 0 ? Math.round((sumJ / (sumOut / 1000)) * 100) / 100 : null,
    total_prompt_tokens: sumIn,
    total_completion_tokens: sumOut,
    tiers,
  };
}

const labels = loadJsonl(`${RUNS}/labels/labels-strict-test.v1.jsonl`) || [];
const labelById = new Map(labels.map((l) => [l.prompt_id, l]));

const files = {
  P0: `${RUNS}/policy-runs-P0-test-energy-${STAMP_P0}.jsonl`,
  P1: `${RUNS}/policy-runs-P1-test-energy-${STAMP_P0}.jsonl`,
  P2: `${RUNS}/policy-runs-P2-test-energy-${STAMP_P2P3}.jsonl`,
  P3: `${RUNS}/policy-runs-P3-test-energy-${STAMP_P2P3}.jsonl`,
};

console.log("=== test split energy batch analysis ===\n");

for (const pol of ["P0", "P1", "P2", "P3"]) {
  const rows = loadJsonl(files[pol]);
  if (!rows) {
    console.log(`${pol}: missing ${files[pol]}\n`);
    continue;
  }
  const s = summarizePolicy(rows, pol);
  console.log(JSON.stringify(s, null, 2));

  if (pol !== "P0" && labels.length) {
    const under = [];
    const over = [];
    for (const r of rows.filter((x) => !x.error && x.http_status === 200)) {
      const lab = labelById.get(r.prompt_id);
      if (!lab || lab.min_adequate_tier == null) continue;
      const chosen = r.routing_tier ?? 1;
      const oracle = lab.min_adequate_tier;
      if (chosen < oracle) under.push(r.prompt_id);
      else if (chosen > oracle) over.push(r.prompt_id);
    }
    if (under.length || over.length) {
      console.log(`  oracle_gaps: under=${under.join(",") || "none"} over=${over.join(",") || "none"}`);
    }
  }
  console.log("");
}

const p0 = loadJsonl(files.P0);
const p1 = loadJsonl(files.P1);
if (p0 && p1) {
  const s0 = summarizePolicy(p0, "P0");
  const s1 = summarizePolicy(p1, "P1");
  console.log("=== P1 vs P0 (headline) ===");
  console.log(
    `latency: ${s1.mean_ms}ms vs ${s0.mean_ms}ms (${Math.round((1 - s1.mean_ms / s0.mean_ms) * 1000) / 10}% faster)`,
  );
  console.log(
    `energy: ${s1.total_j}J vs ${s0.total_j}J (${Math.round((1 - s1.total_j / s0.total_j) * 1000) / 10}% less)`,
  );
  console.log(`mean J/request: ${s1.mean_j}J vs ${s0.mean_j}J`);
}
