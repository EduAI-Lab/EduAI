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
export const SPLITS_PATH = join(SUITE_DIR, "splits.json");
export const DEFAULT_BOTH_TIER_OUT = resolveRunsFile("both-tier.v1.jsonl");
export const DEFAULT_BOTH_TIER_IN = DEFAULT_BOTH_TIER_OUT;
export const DEFAULT_LABELS_OUT = resolveRunsFile("labels.v1.jsonl");
export const DEFAULT_POLICY_OUT = resolveRunsFile("policy-runs.v1.jsonl");
export const DEFAULT_CLASSROOM_OUT = resolveRunsFile("classroom-sim.v1.jsonl");
export const DEFAULT_CLASSROOM_SUMMARY = resolveRunsFile(
  "classroom-sim-summary.v1.txt",
);
