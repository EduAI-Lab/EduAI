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

const LEGACY_FLAT = /^S(\d+)-(on|off)\.md$/;
const CONDITION_SUBDIR = /^S(\d+)-(.+)\.md$/;
const CONDITION_DIRS = ["baseline", "assist-prompt-only", "assist-oversight"];

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

/** @returns {Promise<Array<{ file: string; scenarioId: string; mode: string }>>} */
async function collectTranscriptFiles(runDir) {
  const entries = [];
  const topEntries = await readdir(runDir, { withFileTypes: true });

  for (const ent of topEntries) {
    if (!ent.isFile()) continue;
    const match = ent.name.match(LEGACY_FLAT);
    if (!match) continue;
    entries.push({
      file: path.join(runDir, ent.name),
      scenarioId: `S${match[1]}`,
      mode: match[2],
    });
  }
  if (entries.length > 0) return entries;

  for (const dirName of CONDITION_DIRS) {
    const subDir = path.join(runDir, dirName);
    let subFiles;
    try {
      subFiles = await readdir(subDir);
    } catch {
      continue;
    }
    for (const file of subFiles) {
      const match = file.match(CONDITION_SUBDIR);
      if (!match) continue;
      entries.push({
        file: path.join(subDir, file),
        scenarioId: `S${match[1]}`,
        mode: match[2],
      });
    }
  }

  return entries;
}

async function main() {
  const runDir = path.resolve(process.cwd(), process.argv[2] ?? "");
  if (!runDir) {
    process.stderr.write("Usage: backfill-eval-turn-results.mjs <eval-run-dir>\n");
    process.exit(1);
  }
  const mdFiles = await collectTranscriptFiles(runDir);
  if (mdFiles.length === 0) {
    process.stderr.write(
      "warn: no matching transcript files found. " +
        "Legacy runs use S#-{on|off}.md at the run root; " +
        "new-format runs use condition subdirs (baseline/, assist-prompt-only/, assist-oversight/).\n",
    );
    process.exit(1);
  }
  const all = [];
  for (const { file, scenarioId, mode } of mdFiles) {
    const content = await readFile(file, "utf8");
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
