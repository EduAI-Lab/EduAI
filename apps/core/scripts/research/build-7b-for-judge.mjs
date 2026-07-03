#!/usr/bin/env node
/** Build 7B tier-1 responses for pairing with 14B easy-stratum adequacy runs. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRunRows } from "./both-tier-io.mjs";
import { RUNS_DIR, resolveRunsFile } from "./paths.mjs";

const adequacy14b =
  process.env.RESEARCH_ADEQUACY_14B_IN ??
  join(RUNS_DIR, "adequacy", "adequacy-14b-easy-v1.jsonl");
const outPath =
  process.env.RESEARCH_ADEQUACY_7B_OUT ??
  join(RUNS_DIR, "adequacy", "adequacy-7b-easy-v1.jsonl");

const both = loadRunRows(resolveRunsFile("both-tier.v1.jsonl"), { dedupe: true });
const tier1 = new Map(
  both
    .filter((r) => r.tier === 1 && r.response)
    .map((r) => [r.prompt_id, r]),
);

const ids14 = loadRunRows(adequacy14b, { dedupe: false }).map((r) => r.prompt_id);
const rows = [];
for (const id of ids14) {
  const r = tier1.get(id);
  if (!r) continue;
  rows.push({
    prompt_id: r.prompt_id,
    model: "qwen2.5-7b-instruct",
    response: r.response,
    duration_ms: r.duration_ms ?? null,
    stratum: r.stratum ?? null,
    split: r.split ?? null,
    prompt: r.prompt ?? null,
  });
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
  "utf8",
);
console.log("wrote", rows.length, "→", outPath);
