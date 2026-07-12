#!/usr/bin/env node
/**
 * Aggregate frozen Form A eval runs into per-turn matrices + headline numbers.
 * Supports single run dirs or repeat-run parent dirs (run-01, run-02, …).
 *
 * Usage (single run each):
 *   node eduai-summer-2026/reports/scripts/aggregate-paper1-frozen-eval.mjs \
 *     --baseline eval-runs/paper1-frozen-baseline \
 *     --prompt-only eval-runs/paper1-frozen-prompt-only \
 *     --oversight eval-runs/paper1-frozen-oversight \
 *     --out eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md
 *
 * Usage (repeated runs):
 *   node eduai-summer-2026/reports/scripts/aggregate-paper1-frozen-eval.mjs \
 *     --baseline eval-runs/paper1-repeat-v2/gemini-2.5-flash/baseline \
 *     --prompt-only eval-runs/paper1-repeat-v2/gemini-2.5-flash/prompt-only \
 *     --oversight eval-runs/paper1-repeat-v2/gemini-2.5-flash/oversight \
 *     --repeated --out eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md
 */

import { parseArgs } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCENARIO_TURNS = {
  S1: [1],
  S2: [1, 2, 3],
  S3: [1, 2],
  S5: [1, 2],
  S2L: [1, 2, 3, 4, 5, 6],
};

const LATE_TURN_REFS = new Set([
  "S2.t2", "S2.t3", "S3.t2",
  "S2L.t4", "S2L.t5", "S2L.t6",
  "S5.t2",
]);

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

async function listRunDirs(parentDir) {
  const entries = await readdir(parentDir, { withFileTypes: true });
  const runDirs = entries
    .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
    .map((e) => path.join(parentDir, e.name))
    .sort();
  if (runDirs.length) return runDirs;
  return [parentDir];
}

async function loadTurnResults(dir) {
  const raw = await readFile(path.join(dir, "turn-results.json"), "utf8");
  return JSON.parse(raw);
}

async function loadMeta(dir) {
  try {
    const raw = await readFile(path.join(dir, "run-meta.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function indexByTurn(turnResults) {
  const map = new Map();
  for (const row of turnResults) {
    map.set(`${row.scenarioId}.t${row.turn}`, row);
  }
  return map;
}

function passValue(row, metric) {
  if (!row) return null;
  if (metric === "strict") return Boolean(row.structuralPass);
  if (metric === "profile") {
    if (row.profileStructuralPass != null) return Boolean(row.profileStructuralPass);
    if (row.contextualPass != null) return Boolean(row.contextualPass);
    return Boolean(row.structuralPass);
  }
  return null;
}

function passCell(rate) {
  if (rate == null) return "—";
  return `${rate.pass}/${rate.total} (${rate.pct})`;
}

function computeRate(values) {
  const defined = values.filter((v) => v != null);
  if (!defined.length) return null;
  const pass = defined.filter(Boolean).length;
  const pct = `${Math.round((pass / defined.length) * 100)}%`;
  return { pass, total: defined.length, pct };
}

function fmtRate(rate) {
  return rate ? `${rate.pass}/${rate.total} (${rate.pct})` : "—";
}

function meanPct(rates) {
  const nums = rates.filter(Boolean).map((r) => (r.pass / r.total) * 100);
  if (!nums.length) return "—";
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return `${mean.toFixed(0)}% (range ${min.toFixed(0)}–${max.toFixed(0)}%)`;
}

async function loadArmRuns(armDir, repeated) {
  const dirs = repeated ? await listRunDirs(armDir) : [armDir];
  const runs = [];
  for (const dir of dirs) {
    runs.push({
      dir,
      turns: await loadTurnResults(dir),
      meta: await loadMeta(dir),
    });
  }
  return runs;
}

function allTurnRefs() {
  const keys = [];
  for (const [scenario, turns] of Object.entries(SCENARIO_TURNS)) {
    for (const t of turns) keys.push(`${scenario}.t${t}`);
  }
  return keys;
}

async function main() {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      "prompt-only": { type: "string" },
      oversight: { type: "string" },
      out: { type: "string" },
      repeated: { type: "boolean", default: false },
    },
  });

  const baselineDir = values.baseline ? path.resolve(REPO_ROOT, values.baseline) : fail("--baseline required");
  const promptDir = values["prompt-only"] ? path.resolve(REPO_ROOT, values["prompt-only"]) : fail("--prompt-only required");
  const oversightDir = values.oversight ? path.resolve(REPO_ROOT, values.oversight) : fail("--oversight required");
  const outPath = values.out
    ? path.resolve(REPO_ROOT, values.out)
    : path.join(REPO_ROOT, "eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md");
  const repeated = values.repeated;

  const [bRuns, pRuns, oRuns] = await Promise.all([
    loadArmRuns(baselineDir, repeated),
    loadArmRuns(promptDir, repeated),
    loadArmRuns(oversightDir, repeated),
  ]);

  const turnRefs = allTurnRefs();
  const bMeta = bRuns[0]?.meta ?? {};
  const pMeta = pRuns[0]?.meta ?? {};
  const oMeta = oRuns[0]?.meta ?? {};

  const lines = [
    "# Paper 1 — frozen three-arm eval numbers",
    "",
    "Measured pass rates from local `eval:adhd` runs. **Not paper prose** — numbers only.",
    "",
    repeated
      ? `Repeated runs: baseline **${bRuns.length}**, prompt-only **${pRuns.length}**, oversight **${oRuns.length}**.`
      : "Single run per arm (legacy snapshot).",
    "",
    "## Provenance",
    "",
    "| Arm | Label | Git SHA | Model | Run dir |",
    "| --- | --- | --- | --- | --- |",
    `| Baseline | ${bMeta.label ?? "—"} | \`${bMeta.gitSha ?? "?"}\` | ${bMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, baselineDir)}\` |`,
    `| Prompt-only | ${pMeta.label ?? "—"} | \`${pMeta.gitSha ?? "?"}\` | ${pMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, promptDir)}\` |`,
    `| Oversight | ${oMeta.label ?? "—"} | \`${oMeta.gitSha ?? "?"}\` | ${oMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, oversightDir)}\` |`,
    "",
    "**Strict pass** = Top summary + Next? + under word cap (baseline-style).",
    "**Profile pass** = turn-type-aware (redirect turns use §5 boundary template, not full scaffolding).",
    "",
    "## Failure-mode notes (from spot-check)",
    "",
    "- **S2.t2 redirect:** strict pass penalizes correct one-topic redirects; use profile pass for assist arms.",
    "- **S3.t1 oversight:** occasional missing `**Next?**` when rewrite truncates before tail marker.",
    "- **S2.t3 prompt-only:** variant Top summary formatting (`* Top summary` vs `**Top summary**`) fails strict detector.",
    "",
  ];

  if (repeated) {
    lines.push("## Per-turn pass rates (mean across runs)", "");
    lines.push("| Turn | Baseline strict | Prompt strict | Oversight strict | Prompt profile | Oversight profile |");
    lines.push("| --- | --- | --- | --- | --- | --- |");

    for (const key of turnRefs) {
      const bRates = bRuns.map((run) => computeRate([passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), "strict")]));
      const pStrict = pRuns.map((run) => computeRate([passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), "strict")]));
      const oStrict = oRuns.map((run) => computeRate([passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), "strict")]));
      const pProfile = pRuns.map((run) => computeRate([passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), "profile")]));
      const oProfile = oRuns.map((run) => computeRate([passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), "profile")]));

      lines.push(
        `| ${key} | ${meanPct(bRates)} | ${meanPct(pStrict)} | ${meanPct(oStrict)} | ${meanPct(pProfile)} | ${meanPct(oProfile)} |`,
      );
    }

    lines.push("", "## Summary (mean pass rate across runs)", "");
    lines.push("| Arm | Metric | Overall | Late-turn (t2+ / S2L t4+) |");
    lines.push("| --- | --- | --- | --- |");

    for (const [armName, runs, metric] of [
      ["Baseline", bRuns, "strict"],
      ["Prompt-only", pRuns, "strict"],
      ["Prompt-only", pRuns, "profile"],
      ["Oversight", oRuns, "strict"],
      ["Oversight", oRuns, "profile"],
    ]) {
      const overall = runs.map((run) => {
        const vals = turnRefs.map((key) =>
          passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), metric),
        );
        return computeRate(vals);
      });
      const late = runs.map((run) => {
        const vals = turnRefs
          .filter((key) => LATE_TURN_REFS.has(key))
          .map((key) => passValue(run.turns.find((r) => `${r.scenarioId}.t${r.turn}` === key), metric));
        return computeRate(vals);
      });
      lines.push(`| ${armName} | ${metric} | ${meanPct(overall)} | ${meanPct(late)} |`);
    }
  } else {
    const bIdx = indexByTurn(bRuns[0].turns);
    const pIdx = indexByTurn(pRuns[0].turns);
    const oIdx = indexByTurn(oRuns[0].turns);

    lines.push("## Per-turn matrix (strict)", "");
    lines.push("| Scenario | Turn | Baseline | Prompt-only | Oversight |");
    lines.push("| --- | ---: | :---: | :---: | :---: |");
    for (const key of turnRefs) {
      const [scenario, tPart] = key.split(".t");
      const cell = (row) => (row == null ? "—" : row ? "Y" : "N");
      lines.push(
        `| ${scenario} | ${tPart} | ${cell(passValue(bIdx.get(key), "strict"))} | ${cell(passValue(pIdx.get(key), "strict"))} | ${cell(passValue(oIdx.get(key), "strict"))} |`,
      );
    }

    lines.push("", "## Per-turn matrix (profile-aware, assist arms)", "");
    lines.push("| Scenario | Turn | Prompt-only | Oversight |");
    lines.push("| --- | ---: | :---: | :---: |");
    for (const key of turnRefs) {
      const [scenario, tPart] = key.split(".t");
      const cell = (row) => (row == null ? "—" : row ? "Y" : "N");
      lines.push(
        `| ${scenario} | ${tPart} | ${cell(passValue(pIdx.get(key), "profile"))} | ${cell(passValue(oIdx.get(key), "profile"))} |`,
      );
    }

    const flatKeys = turnRefs;
    const flat = (idx, metric) => flatKeys.map((k) => passValue(idx.get(k), metric)).filter((v) => v != null);
    const rateFromIdx = (idx, metric, filterFn = () => true) =>
      computeRate(flatKeys.filter(filterFn).flatMap((k) => [passValue(idx.get(k), metric)]));

    lines.push("", "## Summary (single run)", "");
    lines.push("| Arm | Metric | Overall strict/profile | Late-turn |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(`| Baseline | strict | ${fmtRate(rateFromIdx(bIdx, "strict"))} | ${fmtRate(rateFromIdx(bIdx, "strict", (k) => LATE_TURN_REFS.has(k)))} |`);
    lines.push(`| Prompt-only | strict | ${fmtRate(rateFromIdx(pIdx, "strict"))} | ${fmtRate(rateFromIdx(pIdx, "strict", (k) => LATE_TURN_REFS.has(k)))} |`);
    lines.push(`| Prompt-only | profile | ${fmtRate(rateFromIdx(pIdx, "profile"))} | ${fmtRate(rateFromIdx(pIdx, "profile", (k) => LATE_TURN_REFS.has(k)))} |`);
    lines.push(`| Oversight | strict | ${fmtRate(rateFromIdx(oIdx, "strict"))} | ${fmtRate(rateFromIdx(oIdx, "strict", (k) => LATE_TURN_REFS.has(k)))} |`);
    lines.push(`| Oversight | profile | ${fmtRate(rateFromIdx(oIdx, "profile"))} | ${fmtRate(rateFromIdx(oIdx, "profile", (k) => LATE_TURN_REFS.has(k)))} |`);
  }

  lines.push("");
  await writeFile(outPath, lines.join("\n"), "utf8");
  process.stdout.write(`Wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
