import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** URA research docs live beside the EduAICoreLearning repo. */
const URA_RESEARCH = join(__dirname, "../../../../../docs/research");
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

export const SUITE_DIR = resolveSuiteDir();
export const RUNS_DIR = resolveRunsDir();
export const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");
export const SPLITS_PATH = join(SUITE_DIR, "splits.json");
export const DEFAULT_BOTH_TIER_OUT = join(RUNS_DIR, "both-tier.v1.jsonl");
export const DEFAULT_BOTH_TIER_IN = DEFAULT_BOTH_TIER_OUT;
export const DEFAULT_LABELS_OUT = join(RUNS_DIR, "labels.v1.jsonl");
export const DEFAULT_POLICY_OUT = join(RUNS_DIR, "policy-runs.v1.jsonl");
export const DEFAULT_CLASSROOM_OUT = join(RUNS_DIR, "classroom-sim.v1.jsonl");
export const DEFAULT_CLASSROOM_SUMMARY = join(RUNS_DIR, "classroom-sim-summary.v1.txt");
