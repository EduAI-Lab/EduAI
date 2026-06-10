#!/usr/bin/env node
/**
 * Merge v2 policy runs with tool-stratum v3 reruns and write summary.
 *
 * RESEARCH_POLICY_TEST_V2 / RESEARCH_POLICY_P1DEV_V2 — base JSONL
 * RESEARCH_POLICY_TOOLS_TEST / RESEARCH_POLICY_TOOLS_P1DEV — tool rerun JSONL
 * RESEARCH_POLICY_TEST_OUT / RESEARCH_POLICY_P1DEV_OUT — merged v3 outputs
 * RESEARCH_POLICY_SUMMARY_OUT — text summary (default policy-summary-v3.txt)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LABELS_OUT, RUNS_DIR } from "./paths.mjs";

function readEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
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

function mergePolicyRows(baseRows, toolRows) {
  const key = (r) => `${r.policy}|${r.prompt_id}`;
  const merged = new Map(baseRows.map((r) => [key(r), r]));
  for (const row of toolRows) {
    merged.set(key(row), row);
  }
  return [...merged.values()].sort((a, b) => {
    const id = a.prompt_id.localeCompare(b.prompt_id);
    if (id !== 0) return id;
    return a.policy.localeCompare(b.policy);
  });
}

function mean(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function summarizePolicyFile(rows, labels) {
  const ok = (r) => !r.error && r.response;
  const lines = [];
  const labelMap = new Map(labels.map((l) => [l.prompt_id, l]));

  for (const pol of ["P0", "P1"]) {
    const subset = rows.filter((r) => r.policy === pol && ok(r));
    if (!subset.length) continue;
    lines.push(`${pol}: n=${subset.length} mean_latency_ms=${mean(subset.map((r) => r.duration_ms))}`);
    if (pol === "P1") {
      const tiers = { 1: 0, 3: 0 };
      for (const r of subset) tiers[r.routing_tier] = (tiers[r.routing_tier] ?? 0) + 1;
      lines.push(`  routing_tier: tier1=${tiers[1]} tier3=${tiers[3]}`);
    }
  }

  const toolRows = rows.filter((r) =>
    ["webSearch", "fetchPage"].includes(r.tools_expected),
  );
  const toolOk = toolRows.filter(ok);
  lines.push(
    `tool_stratum: ${toolOk.length}/${toolRows.length} OK` +
      (toolOk.length
        ? ` mean_ms=${mean(toolOk.map((r) => r.duration_ms))} modes=${[...new Set(toolOk.map((r) => r.tool_execution_mode))].join(",")}`
        : ""),
  );

  const p1Dev = rows.filter((r) => r.policy === "P1" && r.split === "dev" && ok(r));
  if (p1Dev.length && labels.length) {
    let matched = 0;
    let correct = 0;
    let over = 0;
    let under = 0;
    for (const row of p1Dev) {
      const label = labelMap.get(row.prompt_id);
      if (!label || label.min_adequate_tier == null) continue;
      matched++;
      const chosen = row.routing_tier ?? 1;
      const oracle = label.min_adequate_tier;
      if (chosen === oracle) correct++;
      else if (chosen > oracle) over++;
      else under++;
    }
    lines.push("");
    lines.push("P1 dev oracle gap:");
    lines.push(`  matched=${matched} correct=${correct} (${matched ? ((100 * correct) / matched).toFixed(1) : 0}%)`);
    lines.push(`  over-routed=${over} under-routed=${under}`);
  }

  return lines;
}

function main() {
  const testV2 = readEnv("RESEARCH_POLICY_TEST_V2", join(RUNS_DIR, "policy-runs-test.v2.jsonl"));
  const p1DevV2 = readEnv("RESEARCH_POLICY_P1DEV_V2", join(RUNS_DIR, "policy-runs-p1-dev.v2.jsonl"));
  const toolsTest = readEnv("RESEARCH_POLICY_TOOLS_TEST", join(RUNS_DIR, "policy-tools-test.v3.jsonl"));
  const toolsP1Dev = readEnv("RESEARCH_POLICY_TOOLS_P1DEV", join(RUNS_DIR, "policy-tools-p1dev.v3.jsonl"));
  const testOut = readEnv("RESEARCH_POLICY_TEST_OUT", join(RUNS_DIR, "policy-runs-test.v3.jsonl"));
  const p1DevOut = readEnv("RESEARCH_POLICY_P1DEV_OUT", join(RUNS_DIR, "policy-runs-p1-dev.v3.jsonl"));
  const summaryOut = readEnv(
    "RESEARCH_POLICY_SUMMARY_OUT",
    join(RUNS_DIR, "policy-summary-v3.txt"),
  );
  const spotSummary = readEnv(
    "RESEARCH_SPOT_CHECK_SUMMARY",
    join(RUNS_DIR, "hard-spot-check-summary.v1.txt"),
  );
  const labelsPath = readEnv("RESEARCH_LABEL_OUT", DEFAULT_LABELS_OUT);

  const labels = loadJsonl(labelsPath);
  const testMerged = mergePolicyRows(loadJsonl(testV2), loadJsonl(toolsTest));
  const p1DevMerged = mergePolicyRows(loadJsonl(p1DevV2), loadJsonl(toolsP1Dev));

  writeFileSync(testOut, `${testMerged.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  writeFileSync(p1DevOut, `${p1DevMerged.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

  const lines = [
    "=== Policy comparison v3 (tool stratum fixed via hybrid prefetch) ===",
    `Generated: ${new Date().toISOString()}`,
    "",
    "--- Test split ---",
    ...summarizePolicyFile(testMerged, labels),
    "",
    "--- P1 dev ---",
    ...summarizePolicyFile(p1DevMerged, labels),
    "",
    "--- v2 → v3 tool fix ---",
    `test rows: ${testMerged.length} (was 48, tool ts-043 replaced)`,
    `p1 dev rows: ${p1DevMerged.length} (was 96, 5 tool prompts replaced)`,
    "",
    "Files:",
    `  ${testOut}`,
    `  ${p1DevOut}`,
  ];

  try {
    const spot = readFileSync(spotSummary, "utf8").trim();
    if (spot) {
      lines.push("");
      lines.push("--- Strict hard-prompt spot-check ---");
      lines.push(spot);
    }
  } catch {
    lines.push("");
    lines.push("(hard-spot-check summary not found — run research:spot-check-labels)");
  }

  writeFileSync(summaryOut, `${lines.join("\n")}\n`, "utf8");
  console.log(lines.join("\n"));
}

main();
