#!/usr/bin/env node
/**
 * Side-by-side comparison for issue #501 trimmed runs (latest vs main-baseline).
 *
 * Usage:
 *   node scripts/research/compare-issue-501-trim.mjs [runs-dir]
 *
 * Expects outputs from run-issue-501-trim.sh:
 *   track-a-{latest|main-baseline}-summary.txt
 *   track-b-7b-*.jsonl
 *   track-c1-7b-*.txt
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRunsDir = join(__dirname, "../../../../docs/research/data/runs/issue-501-trim");

const runsDir = process.argv[2] ?? defaultRunsDir;

const LABELS = ["latest", "main-baseline"];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function loadJsonl(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

function summarizeChat(rows) {
  if (!rows?.length) return null;
  const ok = rows.filter((r) => !r.error && (r.response || r.http_status === 200));
  const durs = ok.map((r) => r.duration_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const energies = rows.map((r) => r.energy_joules).filter((v) => v != null && Number.isFinite(v));
  return {
    ok: ok.length,
    total: rows.length,
    p50Ms: percentile(durs, 50),
    p95Ms: percentile(durs, 95),
    meanMs: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    totalJoules: energies.length ? Math.round(energies.reduce((a, b) => a + b, 0) * 100) / 100 : null,
  };
}

function parseTrackA(summaryPath) {
  if (!existsSync(summaryPath)) return null;
  const text = readFileSync(summaryPath, "utf8");
  const hit = text.match(/hit_rate \(chunks > 0\): (\d+)\/(\d+)/);
  const strong = text.match(/strong_hit_rate \(top1 >= threshold\): (\d+)\/(\d+)/);
  const p50 = text.match(/p50: (\d+)/);
  const p95 = text.match(/p95: (\d+)/);
  if (!hit) return null;
  return {
    hitNum: Number(hit[1]),
    hitDen: Number(hit[2]),
    hitPct: hit[2] !== "0" ? Math.round((Number(hit[1]) / Number(hit[2])) * 100) : 0,
    strongNum: strong ? Number(strong[1]) : null,
    strongDen: strong ? Number(strong[2]) : null,
    strongPct:
      strong && strong[2] !== "0"
        ? Math.round((Number(strong[1]) / Number(strong[2])) * 100)
        : null,
    p50Ms: p50 ? Number(p50[1]) : null,
    p95Ms: p95 ? Number(p95[1]) : null,
  };
}

function parseClassroomSummary(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const ok = text.match(/OK: (\d+)\/(\d+)/);
  const p50 = text.match(/p50: (\d+)/);
  const p95 = text.match(/p95: (\d+)/);
  const wall = text.match(/wall_time_ms: (\d+)/);
  if (!ok) return null;
  return {
    ok: Number(ok[1]),
    total: Number(ok[2]),
    p50Ms: p50 ? Number(p50[1]) : null,
    p95Ms: p95 ? Number(p95[1]) : null,
    wallMs: wall ? Number(wall[1]) : null,
  };
}

function delta(a, b, suffix = "") {
  if (a == null || b == null) return "—";
  const d = a - b;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d}${suffix}`;
}

function pctDelta(a, b) {
  if (a == null || b == null || b === 0) return "—";
  const d = Math.round(((a - b) / b) * 100);
  const sign = d > 0 ? "+" : "";
  return `${sign}${d}%`;
}

const trackA = {};
const trackB = {};
const trackC = {};

for (const label of LABELS) {
  trackA[label] = parseTrackA(join(runsDir, `track-a-${label}-summary.txt`));
  trackB[label] = summarizeChat(loadJsonl(join(runsDir, `track-b-7b-${label}.jsonl`)));
  trackC[label] = parseClassroomSummary(join(runsDir, `track-c1-7b-${label}.txt`));
}

const latest = "latest";
const main = "main-baseline";

console.log("# Issue #501 — trimmed comparison\n");
console.log(`Runs dir: \`${runsDir}\`\n`);

console.log("## What this measures\n");
console.log("| Track | Pipeline signal |");
console.log("| --- | --- |");
console.log("| **A** | RAG retrieval quality (hit rate, strong-hit rate, latency) — **primary RAG proof** |");
console.log("| **B** | End-to-end chat on 12 fixed course-grounded prompts (7B) |");
console.log("| **C** | Classroom load: 30 students, concurrency 5 (7B) |\n");

console.log("## Track A — retrieval (expect latest ↑ hit rate, ↓ latency)\n");
console.log("| Metric | latest | main-baseline | Δ |");
console.log("| --- | ---: | ---: | ---: |");

if (trackA[latest] || trackA[main]) {
  const l = trackA[latest];
  const m = trackA[main];
  console.log(
    `| Hit rate | ${l ? `${l.hitNum}/${l.hitDen} (${l.hitPct}%)` : "—"} | ${m ? `${m.hitNum}/${m.hitDen} (${m.hitPct}%)` : "—"} | ${l && m ? pctDelta(l.hitPct, m.hitPct) : "—"} |`,
  );
  console.log(
    `| Strong-hit rate | ${l?.strongPct != null ? `${l.strongPct}%` : "—"} | ${m?.strongPct != null ? `${m.strongPct}%` : "—"} | ${l && m ? pctDelta(l.strongPct, m.strongPct) : "—"} |`,
  );
  console.log(
    `| Retrieval p50 (ms) | ${l?.p50Ms ?? "—"} | ${m?.p50Ms ?? "—"} | ${l && m ? delta(l.p50Ms, m.p50Ms) : "—"} |`,
  );
  console.log(
    `| Retrieval p95 (ms) | ${l?.p95Ms ?? "—"} | ${m?.p95Ms ?? "—"} | ${l && m ? delta(l.p95Ms, m.p95Ms) : "—"} |`,
  );
} else {
  console.log("| _(no Track A summaries found)_ | | | |");
}

console.log("\n## Track B — sequential chat (12 RAG prompts, 7B)\n");
console.log("| Metric | latest | main-baseline | Δ |");
console.log("| --- | ---: | ---: | ---: |");

const bl = trackB[latest];
const bm = trackB[main];
if (bl || bm) {
  console.log(
    `| OK | ${bl ? `${bl.ok}/${bl.total}` : "—"} | ${bm ? `${bm.ok}/${bm.total}` : "—"} | — |`,
  );
  console.log(
    `| p50 latency (ms) | ${bl?.p50Ms ?? "—"} | ${bm?.p50Ms ?? "—"} | ${bl && bm ? delta(bl.p50Ms, bm.p50Ms) : "—"} |`,
  );
  console.log(
    `| p95 latency (ms) | ${bl?.p95Ms ?? "—"} | ${bm?.p95Ms ?? "—"} | ${bl && bm ? delta(bl.p95Ms, bm.p95Ms) : "—"} |`,
  );
  console.log(
    `| Total energy (J) | ${bl?.totalJoules ?? "—"} | ${bm?.totalJoules ?? "—"} | ${bl && bm && bl.totalJoules != null && bm.totalJoules != null ? delta(bl.totalJoules, bm.totalJoules) : "—"} |`,
  );
} else {
  console.log("| _(no Track B JSONL found)_ | | | |");
}

console.log("\n## Track C — classroom (30 students, c=5, 7B)\n");
console.log("| Metric | latest | main-baseline | Δ |");
console.log("| --- | ---: | ---: | ---: |");

const cl = trackC[latest];
const cm = trackC[main];
if (cl || cm) {
  console.log(
    `| OK | ${cl ? `${cl.ok}/${cl.total}` : "—"} | ${cm ? `${cm.ok}/${cm.total}` : "—"} | — |`,
  );
  console.log(
    `| p50 latency (ms) | ${cl?.p50Ms ?? "—"} | ${cm?.p50Ms ?? "—"} | ${cl && cm ? delta(cl.p50Ms, cm.p50Ms) : "—"} |`,
  );
  console.log(
    `| p95 latency (ms) | ${cl?.p95Ms ?? "—"} | ${cm?.p95Ms ?? "—"} | ${cl && cm ? delta(cl.p95Ms, cm.p95Ms) : "—"} |`,
  );
  console.log(
    `| Wall time (s) | ${cl?.wallMs != null ? Math.round(cl.wallMs / 1000) : "—"} | ${cm?.wallMs != null ? Math.round(cm.wallMs / 1000) : "—"} | ${cl && cm ? delta(Math.round(cl.wallMs / 1000), Math.round(cm.wallMs / 1000)) : "—"} |`,
  );
} else {
  console.log("| _(no Track C summaries found)_ | | | |");
}

const missing = LABELS.filter(
  (l) => !trackA[l] && !trackB[l] && !trackC[l],
);
if (missing.length) {
  console.log(`\n> Missing runs for: **${missing.join(", ")}**. Run:\n`);
  for (const label of missing) {
    console.log(`> \`bash scripts/research/run-issue-501-trim.sh ${label}\``);
  }
}
