#!/usr/bin/env node
/** Export human worksheet for 32B vs 72B judge disagreements (non-equivalent rows). */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, loadPromptsJsonl, PROMPTS_PATH } from "./paths.mjs";
import { isResearchExcludedToolPrompt } from "./research-prompt-filters.mjs";

const labelsPath =
  process.env.RESEARCH_32B72B_LABELS ??
  join(RUNS_DIR, "labels", "labels-32b-72b.v1.jsonl");
const path32 =
  process.env.RESEARCH_ADEQUACY_32B_IN ??
  join(RUNS_DIR, "adequacy", "adequacy-32b-combined-v1.jsonl");
const path72 =
  process.env.RESEARCH_ADEQUACY_72B_IN ??
  join(RUNS_DIR, "adequacy", "adequacy-72b-hard-v1.jsonl");
const outPath =
  process.env.RESEARCH_HUMAN_CHECK_OUT ??
  join(RUNS_DIR, "human-32b-72b-disagreements.md");

function loadJsonl(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((l) => JSON.parse(l));
}

const promptsById = new Map(loadPromptsJsonl(PROMPTS_PATH).map((p) => [p.id, p]));

const labels = loadJsonl(labelsPath);
const disputed = labels.filter((l) => {
  if (l.quality_delta === "equivalent" && l.xl_necessary !== true) return false;
  const prompt = promptsById.get(l.prompt_id);
  if (prompt && isResearchExcludedToolPrompt(prompt)) return false;
  return true;
});
const map32 = new Map(loadJsonl(path32).map((r) => [r.prompt_id, r]));
const map72 = new Map(loadJsonl(path72).map((r) => [r.prompt_id, r]));

const lines = [
  "# Human adjudication — 32B vs 72B disagreements",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Rows: ${disputed.length} (research-active; web/fetch tool prompts excluded)`,
  "",
  "For each prompt: Is 32B adequate? Is 72B necessary? Your `min_adequate_tier` (2=32B, 4=72B)?",
  "",
  "---",
  "",
];

for (const row of disputed) {
  const id = row.prompt_id;
  const r32 = map32.get(id);
  const r72 = map72.get(id);
  lines.push(`## ${id}`);
  lines.push("");
  lines.push(`- **Stratum:** ${row.stratum} | **Split:** ${row.split}`);
  lines.push(`- **Judge:** ${row.quality_delta} | xl_necessary=${row.xl_necessary}`);
  lines.push(`- **Rationale:** ${row.judge_rationale}`);
  lines.push("");
  if (r32?.prompt || r72?.prompt) {
    lines.push("### Student prompt");
    lines.push("");
    lines.push((r32?.prompt ?? r72?.prompt ?? "").trim());
    lines.push("");
  }
  if (r32?.response) {
    lines.push("### 32B response");
    lines.push("");
    lines.push(r32.response.trim().slice(0, 4000));
    lines.push("");
  }
  if (r72?.response) {
    lines.push("### 72B response");
    lines.push("");
    lines.push(r72.response.trim().slice(0, 4000));
    lines.push("");
  }
  lines.push("### Your review");
  lines.push("");
  lines.push("- [ ] 32B adequate: yes / no");
  lines.push("- [ ] 72B necessary: yes / no");
  lines.push("- [ ] Notes:");
  lines.push("");
  lines.push("---");
  lines.push("");
}

writeFileSync(outPath, lines.join("\n"), "utf8");
console.log("wrote", disputed.length, "rows →", outPath);
