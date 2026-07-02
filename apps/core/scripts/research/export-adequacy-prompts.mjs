#!/usr/bin/env node
/**
 * Export task-suite prompts to adequacy JSONL for run-adequacy-local.py on GPU hosts.
 *
 * Env:
 *   RESEARCH_RUN_SPLIT       dev | test | all
 *   RESEARCH_RUN_STRATUM     easy | medium | hard | comma list
 *   RESEARCH_RUN_IDS         comma ts-### list
 *   RESEARCH_RUN_OUT         output path
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROMPTS_PATH } from "./paths.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadPrompts() {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`prompts line ${i + 1}: ${e.message}`);
    }
  });
}

function main() {
  const split = readEnv("RESEARCH_RUN_SPLIT") ?? "all";
  const stratumRaw = readEnv("RESEARCH_RUN_STRATUM");
  const idsRaw = readEnv("RESEARCH_RUN_IDS");
  const out = readEnv("RESEARCH_RUN_OUT") ?? "adequacy-prompts.jsonl";

  let prompts = loadPrompts();
  if (split !== "all") prompts = prompts.filter((p) => p.split === split);
  if (stratumRaw) {
    const strata = new Set(stratumRaw.split(",").map((s) => s.trim()).filter(Boolean));
    prompts = prompts.filter((p) => strata.has(p.stratum));
  }
  if (idsRaw) {
    const ids = new Set(idsRaw.split(",").map((s) => s.trim()).filter(Boolean));
    prompts = prompts.filter((p) => ids.has(p.id));
  }

  const rows = prompts.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    stratum: p.stratum,
    category: p.category,
    split: p.split,
    rag_context: p.rag_context,
    tools_expected: p.tools_expected,
    course_code: p.course_code ?? null,
  }));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
  console.log("exported:", rows.length, "→", out);
}

main();
