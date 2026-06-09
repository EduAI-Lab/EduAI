#!/usr/bin/env node
/**
 * Validates docs/research/data/task-suite/prompts.v1.jsonl against schema.json
 * and checks split/stratum coverage.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, "../../../docs/research/data/task-suite");
const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");

const STRATA = ["easy", "medium", "hard"];
const STRATUM_TARGETS = { easy: [30, 40], medium: [50, 80], hard: [20, 40] };
const TOTAL_TARGET = [100, 200];
const CATEGORIES = new Set([
  "definition",
  "explanation",
  "problem_solving",
  "code",
  "debugging",
  "rag_grounded",
  "tool_requiring",
]);
const SPLITS = new Set(["dev", "test"]);
const COURSE_CODE_IN_PROMPT = /\b(COSC|MATH|STAT|DATA|PSYO|BIOL|PHYS|HIST|ENGL|PHIL)\s+\d{3}\b/i;
const META_RAG_PHRASES = [
  /\bfrom\s+\w+\s+materials?\b/i,
  /\bcourse\s+(materials?|content|notes)\b/i,
  /\baccording to (our|the)\b/i,
  /\bas covered in\b/i,
  /\bin\s+\w+\s+context\b/i,
];

function loadPrompts() {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`Line ${i + 1}: invalid JSON — ${e.message}`);
    }
  });
}

function validateRow(row, index) {
  const errors = [];
  const line = index + 1;

  if (!/^ts-\d{3}$/.test(row.id ?? "")) {
    errors.push(`L${line}: id must match ts-###`);
  }
  if (!row.prompt || row.prompt.length < 8) {
    errors.push(`L${line}: prompt too short`);
  }
  if (row.prompt?.includes("[paste")) {
    errors.push(`L${line}: prompt contains unresolved placeholder`);
  }
  if (!STRATA.includes(row.stratum)) {
    errors.push(`L${line}: invalid stratum`);
  }
  if (!CATEGORIES.has(row.category)) {
    errors.push(`L${line}: invalid category`);
  }
  if (!["none", "weak", "strong"].includes(row.rag_context)) {
    errors.push(`L${line}: invalid rag_context`);
  }
  if (!["none", "webSearch", "fetchPage", "getInformation"].includes(row.tools_expected)) {
    errors.push(`L${line}: invalid tools_expected`);
  }
  if (!["course_seed", "benchmark_adapted", "synthetic"].includes(row.source)) {
    errors.push(`L${line}: invalid source`);
  }
  if (!SPLITS.has(row.split)) {
    errors.push(`L${line}: invalid split`);
  }
  if (row.rag_context !== "none" && !row.course_code) {
    errors.push(`L${line}: course_code required when rag_context != none`);
  }
  if (COURSE_CODE_IN_PROMPT.test(row.prompt ?? "")) {
    errors.push(`L${line}: prompt must not include course code (course is selected in UI)`);
  }
  for (const pattern of META_RAG_PHRASES) {
    if (pattern.test(row.prompt ?? "")) {
      errors.push(`L${line}: prompt reads like metadata, not a student question`);
      break;
    }
  }

  return errors;
}

const prompts = loadPrompts();
const ids = new Set();
const promptTexts = new Set();
const allErrors = [];

for (let i = 0; i < prompts.length; i++) {
  const row = prompts[i];
  if (ids.has(row.id)) {
    allErrors.push(`Duplicate id: ${row.id}`);
  }
  ids.add(row.id);
  const normalized = row.prompt?.trim().toLowerCase();
  if (promptTexts.has(normalized)) {
    allErrors.push(`Duplicate prompt text: ${row.id}`);
  }
  promptTexts.add(normalized);
  allErrors.push(...validateRow(row, i));
}

const byStratum = Object.fromEntries(STRATA.map((s) => [s, 0]));
const bySplit = { dev: 0, test: 0 };
const byCategory = {};
for (const p of prompts) {
  byStratum[p.stratum]++;
  bySplit[p.split]++;
  byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
}

console.log(`Task suite: ${prompts.length} prompts`);
console.log("By stratum:", byStratum);
console.log("By split:", bySplit);
console.log("By category:", byCategory);

if (allErrors.length) {
  console.error("\nValidation errors:");
  for (const e of allErrors) console.error("  -", e);
  process.exit(1);
}

const warnings = [];
if (prompts.length < TOTAL_TARGET[0] || prompts.length > TOTAL_TARGET[1]) {
  warnings.push(`Total ${prompts.length} outside target ${TOTAL_TARGET[0]}–${TOTAL_TARGET[1]}`);
}
for (const stratum of STRATA) {
  const [min, max] = STRATUM_TARGETS[stratum];
  const n = byStratum[stratum];
  if (n < min || n > max) {
    warnings.push(`${stratum}: ${n} outside target ${min}–${max}`);
  }
}

const testPct = prompts.length ? (bySplit.test / prompts.length) * 100 : 0;
if (prompts.length >= 10 && (testPct < 15 || testPct > 25)) {
  warnings.push(`Test split is ${testPct.toFixed(1)}% (target ~20%)`);
}

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const w of warnings) console.warn("  -", w);
}

console.log("OK — task suite v1 validates");
