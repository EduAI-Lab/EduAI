#!/usr/bin/env node
/**
 * Aggregate three frozen Form A eval runs (baseline / prompt-only / oversight)
 * into a per-turn pass matrix + headline numbers (Block 2 deliverable).
 *
 * Usage:
 *   node eduai-summer-2026/reports/scripts/aggregate-paper1-frozen-eval.mjs \
 *     --baseline eval-runs/paper1-frozen-baseline \
 *     --prompt-only eval-runs/paper1-frozen-prompt-only \
 *     --oversight eval-runs/paper1-frozen-oversight \
 *     --out eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md
 */

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCENARIO_TURNS = {
  S2: [1, 2, 3],
  S3: [1, 2],
};

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

async function loadTurnResults(dir) {
  const p = path.join(dir, "turn-results.json");
  const raw = await readFile(p, "utf8");
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

function passCell(row) {
  if (!row) return "—";
  return row.structuralPass ? "Y" : "N";
}

function rate(rows, filterFn) {
  const subset = rows.filter(filterFn);
  if (!subset.length) return { pass: 0, total: 0, pct: "—" };
  const pass = subset.filter((r) => r.structuralPass).length;
  return { pass, total: subset.length, pct: `${Math.round((pass / subset.length) * 100)}%` };
}

function fmtRate({ pass, total, pct }) {
  return total ? `${pass}/${total} (${pct})` : "—";
}

async function main() {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      "prompt-only": { type: "string" },
      oversight: { type: "string" },
      out: { type: "string" },
    },
  });

  const baselineDir = values.baseline
    ? path.resolve(REPO_ROOT, values.baseline)
    : fail("--baseline required");
  const promptDir = values["prompt-only"]
    ? path.resolve(REPO_ROOT, values["prompt-only"])
    : fail("--prompt-only required");
  const oversightDir = values.oversight
    ? path.resolve(REPO_ROOT, values.oversight)
    : fail("--oversight required");
  const outPath = values.out
    ? path.resolve(REPO_ROOT, values.out)
    : path.join(REPO_ROOT, "eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md");

  const [bTurns, pTurns, oTurns] = await Promise.all([
    loadTurnResults(baselineDir),
    loadTurnResults(promptDir),
    loadTurnResults(oversightDir),
  ]);
  const [bMeta, pMeta, oMeta] = await Promise.all([
    loadMeta(baselineDir),
    loadMeta(promptDir),
    loadMeta(oversightDir),
  ]);

  const bIdx = indexByTurn(bTurns);
  const pIdx = indexByTurn(pTurns);
  const oIdx = indexByTurn(oTurns);

  const allKeys = [];
  for (const [scenario, turns] of Object.entries(SCENARIO_TURNS)) {
    for (const t of turns) allKeys.push(`${scenario}.t${t}`);
  }

  const flat = (turns) =>
    allKeys.map((k) => {
      const [scenario, tPart] = k.split(".t");
      return turns.find((r) => r.scenarioId === scenario && r.turn === Number(tPart));
    }).filter(Boolean);

  const bFlat = flat(bTurns);
  const pFlat = flat(pTurns);
  const oFlat = flat(oTurns);
  const late = (r) => r.turn >= 2;

  const lines = [
    "# Paper 1 — frozen three-arm eval numbers (S2 + S3)",
    "",
    "Measured structural pass rates from local `eval:adhd` runs. **Not paper prose** — numbers only.",
    "",
    "## Provenance",
    "",
    "| Arm | Label | Git SHA | Model | Run dir |",
    "| --- | --- | --- | --- | --- |",
    `| Baseline | ${bMeta.label ?? "—"} | \`${bMeta.gitSha ?? "?"}\` | ${bMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, baselineDir)}\` |`,
    `| Prompt-only | ${pMeta.label ?? "—"} | \`${pMeta.gitSha ?? "?"}\` | ${pMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, promptDir)}\` |`,
    `| Oversight | ${oMeta.label ?? "—"} | \`${oMeta.gitSha ?? "?"}\` | ${oMeta.model ?? "?"} | \`${path.relative(REPO_ROOT, oversightDir)}\` |`,
    "",
    "Pass = strict `structuralPass` (**Top summary** + **Next?** + under word cap).",
    "",
    "## Per-turn matrix",
    "",
    "| Scenario | Turn | Baseline | Prompt-only | Oversight |",
    "| --- | ---: | :---: | :---: | :---: |",
  ];

  for (const key of allKeys) {
    const [scenario, tPart] = key.split(".t");
    lines.push(
      `| ${scenario} | ${tPart} | ${passCell(bIdx.get(key))} | ${passCell(pIdx.get(key))} | ${passCell(oIdx.get(key))} |`,
    );
  }

  lines.push(
    "",
    "## Summary (all S2+S3 turns)",
    "",
    "| Arm | Overall strict pass | Late-turn pass (t2–t3) |",
    "| --- | --- | --- |",
    `| Baseline | ${fmtRate(rate(bFlat, () => true))} | ${fmtRate(rate(bFlat, late))} |`,
    `| Prompt-only | ${fmtRate(rate(pFlat, () => true))} | ${fmtRate(rate(pFlat, late))} |`,
    `| Oversight | ${fmtRate(rate(oFlat, () => true))} | ${fmtRate(rate(oFlat, late))} |`,
    "",
  );

  await writeFile(outPath, lines.join("\n"), "utf8");
  process.stdout.write(`Wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
