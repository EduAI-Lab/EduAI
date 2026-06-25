#!/usr/bin/env node

/**
 * Aggregate per-backend vitest `json-summary` coverage outputs into a single Markdown report.
 *
 * Each backend's `test:coverage` script writes `coverage/coverage-summary.json` (v8 provider,
 * `json-summary` reporter). This reads the `total` block from each and renders one table plus a
 * combined row, then writes `eduai-summer-2026/reports/coverage-report.md`.
 *
 * Scope note: BACKEND packages only (core, ai-tutor-server, question-maker-backend). Frontend
 * suites (ai-tutor app, question-maker frontend) are intentionally excluded.
 *
 * Env:
 *   REPO_ROOT          repo root (default: two levels up from this script)
 *   COMMIT_SHA         commit the run was built from (default: "unknown")
 *   REPORT_TIMESTAMP   ISO timestamp for the report header (default: process start time)
 *   OUTPUT_FILE        output path (default: <repo>/eduai-summer-2026/reports/coverage/coverage-report.md)
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "..", "..");

// label: display name; pkg: workspace package; dir: coverage-summary.json location, repo-relative.
const BACKENDS = [
  { label: "core (edu-ai)", dir: "apps/core/coverage" },
  { label: "ai-tutor-server", dir: "apps/extensions/ai-tutor/server/coverage" },
  { label: "question-maker-backend", dir: "apps/extensions/question-maker/app/backend/coverage" },
];

const METRICS = ["statements", "branches", "functions", "lines"];

function readSummary(dir) {
  const file = path.join(REPO_ROOT, dir, "coverage-summary.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return json && json.total ? json.total : null;
  } catch (error) {
    console.error(`Failed to parse ${file}: ${error.message}`);
    return null;
  }
}

function pct(metric) {
  if (!metric || typeof metric.pct !== "number") {
    return null;
  }
  return metric.pct;
}

function fmtPct(value) {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function fmtCount(metric) {
  if (!metric || typeof metric.covered !== "number" || typeof metric.total !== "number") {
    return "—";
  }
  return `${metric.covered}/${metric.total}`;
}

function buildReport() {
  const rows = BACKENDS.map((backend) => ({
    backend,
    total: readSummary(backend.dir),
  }));

  // Combined totals are a covered/total sum across the backends that produced a summary,
  // so the percentage is weighted by code size rather than a naive average of percentages.
  const combined = {};
  for (const metric of METRICS) {
    combined[metric] = { covered: 0, total: 0 };
  }
  let anyData = false;
  for (const { total } of rows) {
    if (!total) {
      continue;
    }
    anyData = true;
    for (const metric of METRICS) {
      const m = total[metric];
      if (m && typeof m.covered === "number" && typeof m.total === "number") {
        combined[metric].covered += m.covered;
        combined[metric].total += m.total;
      }
    }
  }
  for (const metric of METRICS) {
    const c = combined[metric];
    c.pct = c.total === 0 ? 0 : (c.covered / c.total) * 100;
  }

  const timestamp = process.env.REPORT_TIMESTAMP || new Date().toISOString();
  const sha = process.env.COMMIT_SHA || "unknown";

  const lines = [];
  lines.push("# Backend Test Coverage Report");
  lines.push("");
  lines.push(
    "> **Scope: backend packages only** — `core`, `ai-tutor-server`, and `question-maker-backend`.",
  );
  lines.push(
    "> Frontend suites (ai-tutor app, question-maker frontend) are excluded. Figures cover the unit **and** integration suites in one pass.",
  );
  lines.push("");
  lines.push(`- Generated: \`${timestamp}\``);
  lines.push(`- Commit: \`${sha}\``);
  lines.push("");
  lines.push("| Backend | Statements | Branches | Functions | Lines |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const { backend, total } of rows) {
    if (!total) {
      lines.push(`| ${backend.label} | _no data_ | _no data_ | _no data_ | _no data_ |`);
      continue;
    }
    lines.push(
      `| ${backend.label} | ${fmtPct(pct(total.statements))} | ${fmtPct(pct(total.branches))} | ${fmtPct(pct(total.functions))} | ${fmtPct(pct(total.lines))} |`,
    );
  }
  if (anyData) {
    lines.push(
      `| **Combined** | **${fmtPct(combined.statements.pct)}** | **${fmtPct(combined.branches.pct)}** | **${fmtPct(combined.functions.pct)}** | **${fmtPct(combined.lines.pct)}** |`,
    );
  }
  lines.push("");
  lines.push("### Covered / total");
  lines.push("");
  lines.push("| Backend | Statements | Branches | Functions | Lines |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const { backend, total } of rows) {
    if (!total) {
      lines.push(`| ${backend.label} | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${backend.label} | ${fmtCount(total.statements)} | ${fmtCount(total.branches)} | ${fmtCount(total.functions)} | ${fmtCount(total.lines)} |`,
    );
  }
  lines.push("");
  lines.push(
    "_Generated by `eduai-summer-2026/scripts/generate-coverage-report.js` via the Backend Coverage Report workflow._",
  );
  lines.push("");

  return { markdown: lines.join("\n"), anyData };
}

function main() {
  const { markdown, anyData } = buildReport();
  if (!anyData) {
    console.error(
      "No coverage-summary.json found for any backend. Did `test:coverage` run with the json-summary reporter?",
    );
    process.exit(1);
  }

  const outputFile = process.env.OUTPUT_FILE
    ? path.resolve(process.env.OUTPUT_FILE)
    : path.join(REPO_ROOT, "eduai-summer-2026", "reports", "coverage", "coverage-report.md");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, markdown);
  console.log(`Wrote coverage report to ${outputFile}`);
}

main();
