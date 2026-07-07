/**
 * Merge v1 corpus + static replacements + v2 seed rows into prompts.v2.jsonl.
 *
 * Usage (from apps/core):
 *   node ./scripts/research/build-prompts-v2.mjs
 *
 * Env:
 *   RESEARCH_SUITE_DIR — override task-suite directory (see paths.mjs)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUITE_DIR } from "./paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCES = [
  "prompts.v1.jsonl",
  "prompts.v2-replacements.jsonl",
  "prompts.v2-seed.jsonl",
];

function readJsonl(name) {
  const path = join(SUITE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        throw new Error(`${name}:${i + 1} invalid JSON — ${e.message}`);
      }
    });
}

function main() {
  const rows = [];
  const seen = new Set();

  for (const source of SOURCES) {
    for (const row of readJsonl(source)) {
      if (seen.has(row.id)) {
        throw new Error(`Duplicate prompt id ${row.id} while merging ${source}`);
      }
      seen.add(row.id);
      rows.push(row);
    }
  }

  rows.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));

  const outPath = join(SUITE_DIR, "prompts.v2.jsonl");
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  writeFileSync(outPath, body, "utf8");

  if (process.env.RESEARCH_SKIP_URA_SYNC !== "1") {
    try {
      execSync("node ./scripts/research/sync-task-suite-to-ura.mjs", {
        cwd: join(__dirname, "../.."),
        stdio: "inherit",
      });
    } catch (e) {
      console.warn("URA sync skipped:", e.message);
    }
  }

  const active = rows.filter((r) => r.active !== false).length;
  const byCourse = {};
  for (const row of rows) {
    const key = row.course_code || "(none)";
    byCourse[key] = (byCourse[key] || 0) + 1;
  }

  console.log(`Wrote ${rows.length} rows to ${outPath}`);
  console.log(`Active: ${active} | Inactive: ${rows.length - active}`);
  console.log("By course_code:", byCourse);
}

main();
