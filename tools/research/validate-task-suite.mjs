#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, "../../../docs/research/data/task-suite");
const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");

const STRATA = ["easy", "medium", "hard"];
const CATEGORIES = new Set([
  "definition", "explanation", "problem_solving", "code", "debugging", "rag_grounded", "tool_requiring",
]);
const SPLITS = new Set(["dev", "test"]);

function loadPrompts() {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  return raw ? raw.split("\n").map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
  }) : [];
}

const prompts = loadPrompts();
const errors = [];
for (let i = 0; i < prompts.length; i++) {
  const row = prompts[i];
  if (!/^ts-\d{3}$/.test(row.id ?? "")) errors.push(`L${i + 1}: bad id`);
  if (!STRATA.includes(row.stratum)) errors.push(`L${i + 1}: bad stratum`);
  if (!CATEGORIES.has(row.category)) errors.push(`L${i + 1}: bad category`);
  if (!SPLITS.has(row.split)) errors.push(`L${i + 1}: bad split`);
  if (row.rag_context !== "none" && !row.course_code) errors.push(`L${i + 1}: missing course_code`);
}

console.log(`Task suite: ${prompts.length} prompts`);
if (errors.length) {
  errors.forEach((e) => console.error(e));
  process.exit(1);
}
console.log("OK");
