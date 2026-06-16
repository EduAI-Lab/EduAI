#!/usr/bin/env node
/**
 * Build turn-results.json for older eval runs (pre per-turn export).
 * Run from apps/core:
 *   npx tsx ../../eduai-summer-2026/reports/scripts/backfill-eval-turn-results.mjs ../../eval-runs/2026-06-09T21-14-53-136Z
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeAdhdResponseMetrics,
  isStructuralCompliancePass,
} from "../../../apps/core/app/lib/ai/adhd-metrics.ts";

const TURN_SHAPE = {
  "S1.t1": { expectFullStructure: true, label: "tutoring answer" },
  "S2.t1": { expectFullStructure: true, label: "step ladder" },
  "S2.t2": { expectFullStructure: false, label: "redirect / one-topic boundary" },
  "S2.t3": { expectFullStructure: true, label: "focused step answer" },
  "S3.t1": { expectFullStructure: true, label: "plan + step ladder" },
  "S3.t2": { expectFullStructure: true, label: "plan continuation" },
  "S5.t1": { expectFullStructure: true, label: "brief clarification" },
  "S5.t2": { expectFullStructure: true, label: "rephrase consistency check" },
};

function evaluateContextualPass(turnRef, metrics, assistantText) {
  const shape = TURN_SHAPE[turnRef];
  if (!shape) return { expectedShape: "unknown", contextualPass: null };
  if (shape.expectFullStructure) {
    return { expectedShape: shape.label, contextualPass: isStructuralCompliancePass(metrics) };
  }
  const hasRedirectCue = /separate question|one topic|come back|switch now/i.test(assistantText);
  const overStructured = metrics.topSummary && metrics.wordCount > 60;
  return {
    expectedShape: shape.label,
    contextualPass: !overStructured && (hasRedirectCue || !metrics.topSummary),
  };
}

function parseTranscriptMd(content, scenarioId, mode) {
  const parts = content.split(/^## Turn (\d+) \(assistant\)/m);
  const turns = [];
  for (let i = 1; i < parts.length; i += 2) {
    const turn = Number(parts[i]);
    const body = parts[i + 1] ?? "";
    const assistantText = body.replace(/^[\s\S]*?\n\n/, "").trim();
    const turnRef = `${scenarioId}.t${turn}`;
    const metrics = computeAdhdResponseMetrics(assistantText);
    const structuralPass = isStructuralCompliancePass(metrics);
    const { expectedShape, contextualPass } = evaluateContextualPass(
      turnRef,
      metrics,
      assistantText,
    );
    turns.push({
      scenarioId,
      mode,
      turn,
      turnRef,
      metrics,
      structuralPass,
      expectedShape,
      contextualPass,
    });
  }
  return turns;
}

async function main() {
  const runDir = path.resolve(process.cwd(), process.argv[2] ?? "");
  if (!runDir) {
    process.stderr.write("Usage: backfill-eval-turn-results.mjs <eval-run-dir>\n");
    process.exit(1);
  }
  const files = await readdir(runDir);
  const mdFiles = files.filter((f) => /^S\d+-(on|off)\.md$/.test(f));
  const all = [];
  for (const file of mdFiles) {
    const [, scenarioId, mode] = file.match(/^(S\d+)-(on|off)\.md$/) ?? [];
    const content = await readFile(path.join(runDir, file), "utf8");
    all.push(...parseTranscriptMd(content, scenarioId, mode));
  }
  const out = path.join(runDir, "turn-results.json");
  await writeFile(out, JSON.stringify(all, null, 2));
  process.stdout.write(`Wrote ${all.length} turn rows to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
