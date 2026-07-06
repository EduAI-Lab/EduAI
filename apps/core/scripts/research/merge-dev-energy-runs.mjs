#!/usr/bin/env node
/**
 * Merge dev P0/P1 energy JSONL shards into one file per policy (96 prompts).
 *
 * Usage:
 *   node scripts/research/merge-dev-energy-runs.mjs
 *
 * Env:
 *   RESEARCH_RUNS_DIR  default ../../docs/research/data/runs (from apps/core)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = join(__dirname, "../..");
const RUNS =
  process.env.RESEARCH_RUNS_DIR ??
  join(CORE, "../../docs/research/data/runs");

function loadRows(paths) {
  const rows = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").trim().split("\n")) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function mergePolicy(policy, prefixes) {
  const dir = RUNS;
  const names = readdirSync(dir).filter((n) => {
    if (!n.endsWith(".jsonl")) return false;
    return prefixes.some((p) => n.startsWith(p));
  });
  const paths = names.map((n) => join(dir, n)).sort();
  const rows = loadRows(paths).filter((r) => r.policy === policy);

  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.prompt_id}|${row.policy}|${row.replicate ?? 1}`;
    const prev = byKey.get(key);
    const score = (r) =>
      (r.response ? 4 : 0) +
      (r.energy_joules != null ? 2 : 0) +
      (r.http_status === 200 ? 1 : 0);
    if (!prev || score(row) > score(prev)) byKey.set(key, row);
  }

  const merged = [...byKey.values()].sort((a, b) =>
    a.prompt_id.localeCompare(b.prompt_id),
  );
  const out = join(dir, "policy", `policy-runs-${policy.toLowerCase()}-dev-energy-v1.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    merged.map((r) => JSON.stringify(r)).join("\n") + (merged.length ? "\n" : ""),
    "utf8",
  );

  const ok = merged.filter((r) => r.response && !r.error);
  const ej = ok.map((r) => r.energy_joules).filter((x) => x != null);
  const summary = [
    `# ${policy} dev energy merged`,
    `rows: ${merged.length}`,
    `ok: ${ok.length}`,
    `errors: ${merged.length - ok.length}`,
    `mean_joules: ${ej.length ? (ej.reduce((a, b) => a + b, 0) / ej.length).toFixed(1) : "n/a"}`,
    `sources: ${paths.length} files`,
    "",
  ].join("\n");
  writeFileSync(`${out.replace(/\.jsonl$/, "-summary.txt")}`, summary, "utf8");
  console.log(out, ok.length, "/", merged.length);
  return { out, merged, ok };
}

const p0 = mergePolicy("P0", ["policy-runs-p0-dev-energy", "policy-runs-both-dev-energy"]);
const p1 = mergePolicy("P1", ["policy-runs-p1-dev-energy", "policy-runs-both-dev-energy"]);

const paired = p0.ok.length && p1.ok.length
  ? p0.merged.filter((r) => p1.merged.some((x) => x.prompt_id === r.prompt_id && x.response))
  : [];
console.log("paired_ok", paired.length);
