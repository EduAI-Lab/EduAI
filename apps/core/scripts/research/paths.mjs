import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filterResearchActivePrompts } from "./research-prompt-filters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** URA research docs live beside the EduAICoreLearning repo (main or worktree layout). */
const URA_RESEARCH_CANDIDATES = [
  join(__dirname, "../../../../../docs/research"),
  join(__dirname, "../../../../../../docs/research"),
];

function resolveUraResearchDir() {
  for (const dir of URA_RESEARCH_CANDIDATES) {
    if (existsSync(join(dir, "data/task-suite/prompts.v1.jsonl"))) return dir;
  }
  return URA_RESEARCH_CANDIDATES[0];
}

const URA_RESEARCH = resolveUraResearchDir();
const LOCAL_SUITE = join(__dirname, "data/task-suite");
const LOCAL_RUNS = join(__dirname, "data/runs");

function resolveDir(override, ...candidates) {
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, "prompts.v1.jsonl"))) return dir;
  }
  return candidates[0];
}

function resolveSuiteDir() {
  return resolveDir(
    process.env.RESEARCH_SUITE_DIR?.trim(),
    LOCAL_SUITE,
    join(URA_RESEARCH, "data/task-suite"),
  );
}

function resolveRunsDir() {
  const override = process.env.RESEARCH_RUNS_DIR?.trim();
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  if (existsSync(LOCAL_RUNS)) return LOCAL_RUNS;
  return join(URA_RESEARCH, "data/runs");
}

/**
 * Resolve a run artifact path. Checks organized subfolders first, then flat
 * `runs/` root for backward compatibility.
 */
export function resolveRunsFile(...relativePaths) {
  const runsDir = resolveRunsDir();
  for (const rel of relativePaths) {
    const direct = join(runsDir, rel);
    if (existsSync(direct)) return direct;
    const parts = rel.replace(/\\/g, "/").split("/");
    if (parts.length === 1) {
      const [subdir, name] = inferRunsSubdir(parts[0]);
      const nested = join(runsDir, subdir, name);
      if (existsSync(nested)) return nested;
    }
  }
  return join(runsDir, relativePaths[0]);
}

function inferRunsSubdir(filename) {
  if (
    filename === "labels.v1.jsonl" ||
    filename === "labels-strict.v1.jsonl" ||
    filename === "both-tier.v1.jsonl" ||
    filename.startsWith("hard-spot-check")
  ) {
    return ["labels", filename];
  }
  if (filename.startsWith("adequacy-")) {
    return ["adequacy", filename];
  }
  if (filename.startsWith("classroom-")) {
    return ["classroom", filename];
  }
  if (filename.startsWith("research-status")) {
    return ["status", filename];
  }
  if (filename.startsWith("policy-")) {
    return ["policy", filename];
  }
  return ["", filename];
}

export const SUITE_DIR = resolveSuiteDir();
export const RUNS_DIR = resolveRunsDir();
export const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");
export const PROMPTS_V2_PATH = join(SUITE_DIR, "prompts.v2.jsonl");
export const SPLITS_PATH = join(SUITE_DIR, "splits.json");

/** Resolve prompt corpus path (v1 default; set RESEARCH_SUITE_VERSION=v2). */
export function resolvePromptsPath() {
  const version = (process.env.RESEARCH_SUITE_VERSION || "v1").trim().toLowerCase();
  if (version === "v2") {
    if (!existsSync(PROMPTS_V2_PATH)) {
      throw new Error(`Missing ${PROMPTS_V2_PATH} — run: npm run research:build-v2`);
    }
    return PROMPTS_V2_PATH;
  }
  return PROMPTS_PATH;
}
export const DEFAULT_BOTH_TIER_OUT = resolveRunsFile("both-tier.v1.jsonl");
export const DEFAULT_BOTH_TIER_IN = DEFAULT_BOTH_TIER_OUT;
export const DEFAULT_LABELS_OUT = resolveRunsFile("labels.v1.jsonl");
export const DEFAULT_POLICY_OUT = resolveRunsFile("policy-runs.v1.jsonl");
export const DEFAULT_CLASSROOM_OUT = resolveRunsFile("classroom-sim.v1.jsonl");
export const DEFAULT_CLASSROOM_SUMMARY = resolveRunsFile(
  "classroom-sim-summary.v1.txt",
);

export function loadPromptsJsonl(path = PROMPTS_PATH) {
  if (!existsSync(path)) return [];
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

/** Prompts eligible for policy / adequacy / classroom research (excludes web tools). */
export function loadResearchActivePrompts(path = PROMPTS_PATH) {
  const all = loadPromptsJsonl(path);
  const { active, skipped, excludedToolIds } = filterResearchActivePrompts(all);
  return { prompts: active, all, skipped, excludedToolIds };
}
