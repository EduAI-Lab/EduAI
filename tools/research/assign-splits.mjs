#!/usr/bin/env node
/**
 * Assigns deterministic 80/20 dev/test splits to prompts.v1.jsonl.
 * Uses SHA-256 hash of id — stable across runs.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, "../../../docs/research/data/task-suite");
const PROMPTS_PATH = join(SUITE_DIR, "prompts.v1.jsonl");
const SPLITS_PATH = join(SUITE_DIR, "splits.json");
const TEST_FRACTION = 0.2;

function bucket(id) {
  const h = createHash("sha256").update(id).digest();
  const n = h.readUInt32BE(0) / 0xffffffff;
  return n < TEST_FRACTION ? "test" : "dev";
}

const lines = readFileSync(PROMPTS_PATH, "utf8").trim().split("\n");
const updated = [];
const manifest = { version: 1, test_fraction: TEST_FRACTION, assignments: {} };

for (const line of lines) {
  const row = JSON.parse(line);
  row.split = bucket(row.id);
  manifest.assignments[row.id] = row.split;
  updated.push(JSON.stringify(row));
}

writeFileSync(PROMPTS_PATH, updated.join("\n") + "\n", "utf8");
writeFileSync(SPLITS_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

const counts = updated.reduce(
  (acc, line) => {
    const s = JSON.parse(line).split;
    acc[s]++;
    return acc;
  },
  { dev: 0, test: 0 },
);

const byStratum = updated.reduce(
  (acc, line) => {
    const stratum = JSON.parse(line).stratum;
    acc[stratum] = (acc[stratum] ?? 0) + 1;
    return acc;
  },
  { easy: 0, medium: 0, hard: 0 },
);

console.log(`Updated ${updated.length} prompts — dev: ${counts.dev}, test: ${counts.test}`);
console.log("By stratum:", byStratum);
console.log(`Wrote ${SPLITS_PATH}`);
