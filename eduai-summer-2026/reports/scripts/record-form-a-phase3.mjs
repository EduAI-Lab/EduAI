#!/usr/bin/env node
/**
 * Build IURA Form A before/after comparison from two eval:adhd runs.
 *
 * Usage (from apps/core):
 *   npx tsx ../../eduai-summer-2026/reports/scripts/record-form-a-phase3.mjs \
 *     --baseline ../../eval-runs/2026-06-09T21-14-53-136Z \
 *     --after ../../eval-runs/<AFTER_STAMP> \
 *     --out ../../eduai-summer-2026/reports/form-a/phase3-after-record.md
 */

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function yn(v) {
  return v ? "Y" : "N";
}

function passCell(pass) {
  if (pass === null || pass === undefined) return "—";
  return pass ? "PASS" : "FAIL";
}

function indexTurnResults(turnResults) {
  const map = new Map();
  for (const row of turnResults) {
    map.set(`${row.scenarioId}.${row.mode}.t${row.turn}`, row);
  }
  return map;
}

function buildMarkdown({ baselineMeta, afterMeta, baselineTurns, afterTurns, baselineDir, afterDir }) {
  const lines = [];
  lines.push("# IURA Form A — Phase 3 oversight before/after record");
  lines.push("");
  lines.push("Synthetic eval only (Form A §3b). No participant data.");
  lines.push("");
  lines.push("## Run metadata");
  lines.push("");
  lines.push("| Field | Before (baseline) | After (oversight ON) |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Git SHA | \`${baselineMeta.gitSha ?? "?"}\` | \`${afterMeta.gitSha ?? "?"}\` |`);
  lines.push(`| Model | ${baselineMeta.model ?? "?"} | ${afterMeta.model ?? "?"} |`);
  lines.push(`| Base URL | ${baselineMeta.baseUrl ?? "?"} | ${afterMeta.baseUrl ?? "?"} |`);
  lines.push(`| Captured | ${baselineMeta.timestamp ?? "?"} | ${afterMeta.timestamp ?? "?"} |`);
  lines.push(
    `| Oversight | ${baselineMeta.oversight?.enabled === false ? "off" : "not recorded"} | ${afterMeta.oversight?.enabled === false ? "off" : afterMeta.oversight?.enabled ? "on" : "assumed on"} |`,
  );
  lines.push(`| Eval dir | \`${path.relative(REPO_ROOT, baselineDir)}\` | \`${path.relative(REPO_ROOT, afterDir)}\` |`);
  lines.push(`| Label | ${baselineMeta.label ?? "—"} | ${afterMeta.label ?? "—"} |`);
  lines.push("");

  const afterOn = afterTurns.filter((t) => t.mode === "on");
  const baselineOn = baselineTurns.filter((t) => t.mode === "on");

  lines.push("## Strict structural compliance (per turn, Assist ON)");
  lines.push("");
  lines.push("Pass = literal `**Top summary**` + `**Next?**` in tail + under word cap.");
  lines.push("");
  lines.push("| Turn | Before structural | After structural | Δ |");
  lines.push("| --- | :---: | :---: | :---: |");

  for (const row of afterOn) {
    const key = `${row.scenarioId}.on.t${row.turn}`;
    const before = baselineOn.find(
      (b) => b.scenarioId === row.scenarioId && b.turn === row.turn,
    );
    const bPass = before?.structuralPass ?? null;
    const aPass = row.structuralPass;
    const delta =
      bPass === null || aPass === null
        ? "—"
        : !bPass && aPass
          ? "improved"
          : bPass && !aPass
            ? "regressed"
            : "same";
    lines.push(
      `| ${row.scenarioId} t${row.turn} | ${passCell(bPass)} | ${passCell(aPass)} | ${delta} |`,
    );
  }
  lines.push("");

  lines.push("## Contextual appropriateness (per turn, Assist ON)");
  lines.push("");
  lines.push("Pass = response shape matches turn intent (e.g. S2 t2 redirect should **not** get a full Top summary block).");
  lines.push("");
  lines.push("| Turn | Expected shape | Before contextual | After contextual | Δ |");
  lines.push("| --- | --- | :---: | :---: | :---: |");

  for (const row of afterOn) {
    const before = baselineOn.find(
      (b) => b.scenarioId === row.scenarioId && b.turn === row.turn,
    );
    const bPass = before?.contextualPass ?? null;
    const aPass = row.contextualPass;
    const delta =
      bPass === null || aPass === null
        ? "—"
        : !bPass && aPass
          ? "improved"
          : bPass && !aPass
            ? "regressed"
            : "same";
    lines.push(
      `| ${row.scenarioId} t${row.turn} | ${row.expectedShape ?? "—"} | ${passCell(bPass)} | ${passCell(aPass)} | ${delta} |`,
    );
  }
  lines.push("");

  const afterStrict = afterOn.filter((t) => t.structuralPass).length;
  const afterContext = afterOn.filter((t) => t.contextualPass).length;
  const beforeStrict = baselineOn.filter((t) => t.structuralPass).length;
  const beforeContext = baselineOn.filter((t) => t.contextualPass).length;

  lines.push("## Summary counts (Assist ON turns)");
  lines.push("");
  lines.push(`- **Strict structural:** before ${beforeStrict}/${baselineOn.length} → after ${afterStrict}/${afterOn.length}`);
  lines.push(`- **Contextual shape:** before ${beforeContext}/${baselineOn.length} → after ${afterContext}/${afterOn.length}`);
  lines.push("");
  lines.push("## Interpretation notes");
  lines.push("");
  lines.push("- Phase 3 v1 (structural oversight) optimizes **literal anchors** on every non-compliant draft.");
  lines.push("- A **Dean** second model is still needed when structure should be **context-dependent** (e.g. S2 t2 topic-drift redirect).");
  lines.push("- If after-capture shows S2 t2 **structural PASS** but **contextual FAIL**, oversight is over-applying templates — Dean should gate structure by turn type.");
  lines.push("");
  lines.push("## Evidence links");
  lines.push("");
  for (const id of [...new Set(afterOn.map((t) => t.scenarioId))]) {
    lines.push(`- ${id}: before \`${path.relative(REPO_ROOT, path.join(baselineDir, `${id}-on.md`))}\`, after \`${path.relative(REPO_ROOT, path.join(afterDir, `${id}-on.md`))}\``);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      after: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(`Usage: record-form-a-phase3.mjs --baseline <dir> --after <dir> [--out <file>]\n`);
    process.exit(0);
  }

  if (!values.baseline || !values.after) {
    fail("--baseline and --after are required.");
  }

  const baselineDir = path.resolve(process.cwd(), values.baseline);
  const afterDir = path.resolve(process.cwd(), values.after);
  const outFile = values.out
    ? path.resolve(process.cwd(), values.out)
    : path.join(afterDir, "form-a-phase3-record.md");

  const baselineMeta = await loadJson(path.join(baselineDir, "run-meta.json"));
  const afterMeta = await loadJson(path.join(afterDir, "run-meta.json"));
  const baselineTurns = await loadJson(path.join(baselineDir, "turn-results.json"));
  const afterTurns = await loadJson(path.join(afterDir, "turn-results.json"));

  const md = buildMarkdown({
    baselineMeta,
    afterMeta,
    baselineTurns,
    afterTurns,
    baselineDir,
    afterDir,
  });

  await writeFile(outFile, md);
  process.stdout.write(`Form A record written: ${outFile}\n`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
