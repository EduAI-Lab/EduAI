import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** URA research docs live beside the EduAICoreLearning repo. */
const URA_RESEARCH = join(__dirname, "../../../../../docs/research");
const LOCAL_SUITE = join(__dirname, "data/task-suite");
const LOCAL_RUNS = join(__dirname, "data/runs");

function resolveSuiteDir() {
  const override = process.env.RESEARCH_SUITE_DIR?.trim();
  if (override) return override;

  const uraSuite = join(URA_RESEARCH, "data/task-suite");
  if (existsSync(join(uraSuite, "prompts.v1.jsonl"))) return uraSuite;
  if (existsSync(join(LOCAL_SUITE, "prompts.v1.jsonl"))) return LOCAL_SUITE;

  return uraSuite;
}

function resolveRunsDir() {
  const override = process.env.RESEARCH_RUNS_DIR?.trim();
  if (override) return override;

  const uraRuns = join(URA_RESEARCH, "data/runs");
  if (existsSync(uraRuns)) return uraRuns;
  if (existsSync(LOCAL_RUNS)) return LOCAL_RUNS;

  return uraRuns;
}

export const SUITE_DIR = resolveSuiteDir();
export const RUNS_DIR = resolveRunsDir();
export const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");
export const SPLITS_PATH = join(SUITE_DIR, "splits.json");
export const DEFAULT_BOTH_TIER_OUT = join(RUNS_DIR, "both-tier.v1.jsonl");
