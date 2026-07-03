#!/usr/bin/env node
/** Build combined 32B responses for judge pairing (dev both-tier + test P0 policy). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRunRows } from "./both-tier-io.mjs";
import { RUNS_DIR, resolveRunsFile } from "./paths.mjs";

const TEST_IDS = new Set(
  "ts-040,ts-043,ts-046,ts-103,ts-105,ts-107,ts-108,ts-115,ts-117".split(","),
);
const outPath =
  process.env.RESEARCH_ADEQUACY_32B_OUT ??
  join(RUNS_DIR, "adequacy", "adequacy-32b-combined-v1.jsonl");

const both = loadRunRows(resolveRunsFile("both-tier.v1.jsonl"), { dedupe: true });
const policyPath = join(RUNS_DIR, "policy-runs-both-test-energy-v2.jsonl");
const policy = readFileSync(policyPath, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const map = new Map();
for (const r of both) {
  if (r.tier === 3 && r.response) map.set(r.prompt_id, r);
}
for (const r of policy) {
  if (r.policy === "P0" && TEST_IDS.has(r.prompt_id) && r.response) {
    map.set(r.prompt_id, {
      prompt_id: r.prompt_id,
      response: r.response,
      duration_ms: r.duration_ms,
      stratum: r.stratum,
      split: r.split,
      prompt: r.prompt,
    });
  }
}

const rows = [...map.values()];
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  rows
    .map((r) =>
      JSON.stringify({
        prompt_id: r.prompt_id,
        model: "qwen2.5-32b-instruct",
        response: r.response,
        duration_ms: r.duration_ms ?? null,
        stratum: r.stratum ?? null,
        split: r.split ?? null,
        prompt: r.prompt ?? null,
      }),
    )
    .join("\n") + "\n",
  "utf8",
);
console.log("wrote", rows.length, "→", outPath);
