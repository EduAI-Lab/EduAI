import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** URA research docs live beside the EduAICoreLearning repo. */
const URA_RESEARCH = join(__dirname, "../../../../../docs/research");

export const SUITE_DIR = join(URA_RESEARCH, "data/task-suite");
export const RUNS_DIR = join(URA_RESEARCH, "data/runs");
export const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");
export const SPLITS_PATH = join(SUITE_DIR, "splits.json");
export const DEFAULT_BOTH_TIER_OUT = join(RUNS_DIR, "both-tier.v1.jsonl");
