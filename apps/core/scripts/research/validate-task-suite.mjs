#!/usr/bin/env node
/**
 * Validates docs/research/data/task-suite/prompts.v1.jsonl against schema.json
 * and checks split/stratum coverage.
 */
import { readFileSync } from "node:fs";
import { resolvePromptsPath } from "./paths.mjs";
import { isResearchExcludedToolPrompt } from "./research-prompt-filters.mjs";

const PROMPTS_PATH = resolvePromptsPath();
const SUITE_VERSION = process.env.RESEARCH_SUITE_VERSION?.trim().toLowerCase() === "v2" ? "v2" : "v1";

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
const COURSE_THEMES = new Set([
  "intro_programming",
  "data_structures",
  "machine_arch",
  "software_engineering",
  "os",
]);
const STYLES = new Set(["mathy", "theory", "application"]);
const V2_CS_THEME_MINS = {
  intro_programming: 5,
  data_structures: 5,
  machine_arch: 3,
  software_engineering: 3,
  os: 5,
};
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
  if (row.course_theme != null && !COURSE_THEMES.has(row.course_theme)) {
    errors.push(`L${line}: invalid course_theme`);
  }
  if (row.style != null && !STYLES.has(row.style)) {
    errors.push(`L${line}: invalid style`);
  }
  if (row.replicate_of != null && !/^ts-\d{3}$/.test(row.replicate_of)) {
    errors.push(`L${line}: invalid replicate_of`);
  }

  return errors;
}

const prompts = loadPrompts();
const researchActive = prompts.filter(
  (p) => p.active !== false && !isResearchExcludedToolPrompt(p),
);
const excludedWeb = prompts.filter(isResearchExcludedToolPrompt);
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

console.log(`Task suite ${SUITE_VERSION}: ${prompts.length} prompts (${PROMPTS_PATH})`);
console.log(`Research-active (excludes web/fetch tools): ${researchActive.length}`);
if (excludedWeb.length) {
  console.log(
    "Excluded from research (web tools):",
    excludedWeb.map((p) => p.id).join(", "),
  );
}
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

if (SUITE_VERSION === "v2") {
  const byTheme = {};
  for (const p of prompts) {
    if (!p.course_theme) continue;
    byTheme[p.course_theme] = (byTheme[p.course_theme] ?? 0) + 1;
  }
  console.log("By course_theme (v2 seed rows):", byTheme);
  for (const [theme, min] of Object.entries(V2_CS_THEME_MINS)) {
    const n = byTheme[theme] ?? 0;
    if (n < min) {
      warnings.push(`course_theme ${theme}: ${n} below minimum ${min}`);
    }
  }
  const sensitivityGroups = new Set(
    prompts.filter((p) => p.sensitivity_group).map((p) => p.sensitivity_group),
  );
  if (sensitivityGroups.size < 2) {
    warnings.push(`Only ${sensitivityGroups.size} sensitivity_group values (target >= 2)`);
  }
}

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const w of warnings) console.warn("  -", w);
}

console.log(`OK — task suite ${SUITE_VERSION} validates`);
