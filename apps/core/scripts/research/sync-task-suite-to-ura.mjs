/**
 * Copy bundled task-suite files to canonical URA/docs/research/data/task-suite.
 *
 * Usage (from apps/core):
 *   node ./scripts/research/sync-task-suite-to-ura.mjs
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_DIR } from "./paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const URA_SUITE_CANDIDATES = [
  join(__dirname, "../../../../../docs/research/data/task-suite"),
  join(__dirname, "../../../../../../docs/research/data/task-suite"),
];

function resolveUraSuiteDir() {
  for (const dir of URA_SUITE_CANDIDATES) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`Canonical suite dir not found (tried: ${URA_SUITE_CANDIDATES.join(", ")})`);
}

const FILES = [
  "prompts.v1.jsonl",
  "prompts.v2-replacements.jsonl",
  "prompts.v2-seed.jsonl",
  "prompts.v2.jsonl",
  "schema.json",
  "splits.json",
];

function syncTaskSuiteToUra() {
  const URA_SUITE = resolveUraSuiteDir();
  for (const name of FILES) {
    const src = join(SUITE_DIR, name);
    if (!existsSync(src)) {
      console.warn(`skip missing ${name}`);
      continue;
    }
    const dest = join(URA_SUITE, name);
    copyFileSync(src, dest);
    console.log(`copied ${name}`);
  }
}

function main() {
  syncTaskSuiteToUra();
}

main();

export { syncTaskSuiteToUra };
