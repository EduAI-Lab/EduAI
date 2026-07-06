#!/usr/bin/env node
/**
 * Build per-prompt routing evidence table (CSV) from task suite + run artifacts.
 *
 * Env:
 *   RESEARCH_MATRIX_OUT   default docs/research/data/analysis/prompt-routing-matrix.csv
 *   RESEARCH_LABEL_IN     default labels-strict.v1.jsonl
 *   RESEARCH_BOTH_TIER_IN default both-tier.v1.jsonl
 *   RESEARCH_POLICY_IN    comma-separated policy JSONL paths (optional; auto-discover latest P1/P3 dev+test)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_BOTH_TIER_IN,
  loadPromptsJsonl,
  PROMPTS_PATH,
  RUNS_DIR,
  resolveRunsFile,
} from "./paths.mjs";
import { isResearchActivePrompt } from "./research-prompt-filters.mjs";
import { loadRunRows } from "./both-tier-io.mjs";
import { rowMatchesPolicy } from "./policy-ids.mjs";

const DEFAULT_LABELS = resolveRunsFile("labels-strict.v1.jsonl");
const DEFAULT_OUT = join(
  dirname(RUNS_DIR),
  "analysis",
  "prompt-routing-matrix.csv",
);

function readEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${e.message}`);
    }
  });
}

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsv(row, columns) {
  return columns.map((c) => csvEscape(row[c])).join(",");
}

function latestPolicyFiles() {
  const policyDir = join(RUNS_DIR, "policy");
  const rootDir = RUNS_DIR;
  const files = new Set();
  for (const dir of [policyDir, rootDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith("policy-runs-") && name.endsWith(".jsonl")) {
        files.add(join(dir, name));
      }
    }
  }
  return [...files].sort();
}

function indexPolicyRows(files) {
  /** @type {Map<string, object>} */
  const byPromptPolicy = new Map();
  for (const file of files) {
    for (const row of loadJsonl(file)) {
      if (!row.prompt_id || !row.policy) continue;
      const pol = String(row.policy).toUpperCase();
      const key = `${row.prompt_id}|${pol}`;
      const prev = byPromptPolicy.get(key);
      if (
        !prev ||
        String(row.recorded_at ?? "") > String(prev.recorded_at ?? "") ||
        (row.run_label ?? "") > (prev.run_label ?? "")
      ) {
        byPromptPolicy.set(key, { ...row, _source_file: file });
      }
    }
  }
  return byPromptPolicy;
}

function indexAdequacyRows(files) {
  /** @type {Map<string, object>} */
  const byPromptModel = new Map();
  for (const file of files) {
    for (const row of loadJsonl(file)) {
      if (!row.prompt_id || !row.model) continue;
      const modelKey = String(row.model).toLowerCase();
      const key = `${row.prompt_id}|${modelKey}`;
      const prev = byPromptModel.get(key);
      if (
        !prev ||
        String(row.recorded_at ?? "") > String(prev.recorded_at ?? "") ||
        (row.run_label ?? "") > (prev.run_label ?? "")
      ) {
        byPromptModel.set(key, row);
      }
    }
  }
  return byPromptModel;
}

function discoverAdequacyFiles() {
  const adequacyDir = join(RUNS_DIR, "adequacy");
  if (!existsSync(adequacyDir)) return [];
  return readdirSync(adequacyDir)
    .filter((name) => name.startsWith("adequacy-") && name.endsWith(".jsonl"))
    .map((name) => join(adequacyDir, name))
    .sort();
}

function adequacyForPrompt(map, promptId, modelFragment) {
  for (const [key, row] of map.entries()) {
    if (!key.startsWith(`${promptId}|`)) continue;
    if (key.includes(modelFragment)) return row;
  }
  return null;
}

function indexBothTier(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.prompt_id || row.tier == null) continue;
    const key = `${row.prompt_id}|${row.tier}`;
    const prev = map.get(key);
    if (!prev || String(row.recorded_at ?? "") > String(prev.recorded_at ?? "")) {
      map.set(key, row);
    }
  }
  return map;
}

function simpleComplex(label) {
  if (!label || label.min_adequate_tier == null) return "";
  return label.min_adequate_tier === 1 ? "simple" : "complex";
}

function main() {
  const outPath = readEnv("RESEARCH_MATRIX_OUT", DEFAULT_OUT);
  const labelsPath = readEnv("RESEARCH_LABEL_IN", DEFAULT_LABELS);
  const bothTierPath = readEnv("RESEARCH_BOTH_TIER_IN", DEFAULT_BOTH_TIER_IN);
  const policyIn = readEnv("RESEARCH_POLICY_IN");

  const prompts = loadPromptsJsonl(PROMPTS_PATH).filter(isResearchActivePrompt);
  if (prompts.length === 0) {
    console.error(`No prompts at ${PROMPTS_PATH}`);
    process.exit(1);
  }

  const labels = loadJsonl(labelsPath);
  const labelById = new Map(labels.map((l) => [l.prompt_id, l]));

  const bothTierRows = existsSync(bothTierPath)
    ? loadRunRows(bothTierPath, { dedupe: false })
    : [];
  const bothTier = indexBothTier(bothTierRows);

  const policyFiles = policyIn
    ? policyIn.split(",").map((s) => s.trim()).filter(Boolean)
    : latestPolicyFiles();
  const policyByPrompt = indexPolicyRows(policyFiles);

  const adequacyFiles = discoverAdequacyFiles();
  const adequacyByPrompt = indexAdequacyRows(adequacyFiles);

  const columns = [
    "prompt_id",
    "split",
    "stratum",
    "category",
    "rag_context",
    "tools_expected",
    "course_code",
    "simple_complex",
    "min_adequate_tier",
    "tier_sensitive",
    "quality_delta",
    "tier1_adequacy",
    "tier3_adequacy",
    "tier1_duration_ms",
    "tier3_duration_ms",
    "tier1_response_len",
    "tier3_response_len",
    "duration_14b_ms",
    "response_len_14b",
    "duration_72b_ms",
    "response_len_72b",
    "adequacy_72b_run_label",
    "p0_routed_model",
    "p0_routing_tier",
    "p0_duration_ms",
    "p1_routed_model",
    "p1_routing_tier",
    "p1_router_version",
    "p1_router_rule",
    "p1_route_classify_ms",
    "p1_rag_prefetch_ms",
    "p1_model_decode_ms",
    "p1_duration_ms",
    "p1_energy_joules",
    "p3_routed_model",
    "p3_routing_tier",
    "p3_duration_ms",
    "policies_disagree_p1_p3",
    "p1_matches_oracle",
    "p3_matches_oracle",
    "prompt_preview",
  ];

  const matrixRows = [];

  for (const p of prompts) {
    const label = labelById.get(p.id);
    const t1 = bothTier.get(`${p.id}|1`);
    const t3 = bothTier.get(`${p.id}|3`);
    const p0 = policyByPrompt.get(`${p.id}|P0`);
    const p1 = policyByPrompt.get(`${p.id}|P1`);
    const p3 = policyByPrompt.get(`${p.id}|P3`);
    const row14b = adequacyForPrompt(adequacyByPrompt, p.id, "14b");
    const row72b = adequacyForPrompt(adequacyByPrompt, p.id, "72b");

    const oracleTier = label?.min_adequate_tier ?? null;
    const p1Tier = p1?.routing_tier ?? null;
    const p3Tier = p3?.routing_tier ?? null;

    const p1Match =
      oracleTier != null && p1Tier != null ? (p1Tier === oracleTier ? "yes" : "no") : "";
    const p3Match =
      oracleTier != null && p3Tier != null ? (p3Tier === oracleTier ? "yes" : "no") : "";

    const policiesDisagree =
      p1Tier != null && p3Tier != null && p1Tier !== p3Tier ? "yes" : "no";

    matrixRows.push({
      prompt_id: p.id,
      split: p.split,
      stratum: p.stratum,
      category: p.category,
      rag_context: p.rag_context,
      tools_expected: p.tools_expected,
      course_code: p.course_code ?? "",
      simple_complex: simpleComplex(label),
      min_adequate_tier: oracleTier ?? "",
      tier_sensitive: label?.tier_sensitive === true ? "yes" : label ? "no" : "",
      quality_delta: label?.quality_delta ?? "",
      tier1_adequacy: label?.tier1_adequacy ?? "",
      tier3_adequacy: label?.tier3_adequacy ?? "",
      tier1_duration_ms: label?.tier1_duration_ms ?? t1?.duration_ms ?? "",
      tier3_duration_ms: label?.tier3_duration_ms ?? t3?.duration_ms ?? "",
      tier1_response_len: t1?.response?.length ?? "",
      tier3_response_len: t3?.response?.length ?? "",
      duration_14b_ms: row14b?.duration_ms ?? "",
      response_len_14b: row14b?.response?.length ?? "",
      duration_72b_ms: row72b?.duration_ms ?? "",
      response_len_72b: row72b?.response?.length ?? "",
      adequacy_72b_run_label: row72b?.run_label ?? "",
      p0_routed_model: p0?.routed_model ?? "",
      p0_routing_tier: p0?.routing_tier ?? "",
      p0_duration_ms: p0?.duration_ms ?? "",
      p1_routed_model: p1?.routed_model ?? "",
      p1_routing_tier: p1Tier ?? "",
      p1_router_version: p1?.router_version ?? "",
      p1_router_rule: p1?.router_rule ?? "",
      p1_route_classify_ms: p1?.route_classify_ms ?? "",
      p1_rag_prefetch_ms: p1?.rag_prefetch_ms ?? "",
      p1_model_decode_ms: p1?.model_decode_ms ?? "",
      p1_duration_ms: p1?.duration_ms ?? "",
      p1_energy_joules: p1?.energy_joules ?? "",
      p3_routed_model: p3?.routed_model ?? "",
      p3_routing_tier: p3Tier ?? "",
      p3_duration_ms: p3?.duration_ms ?? "",
      policies_disagree_p1_p3: policiesDisagree,
      p1_matches_oracle: p1Match,
      p3_matches_oracle: p3Match,
      prompt_preview:
        p.prompt.length > 120 ? `${p.prompt.slice(0, 117)}…` : p.prompt,
    });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const header = rowToCsv(
    Object.fromEntries(columns.map((c) => [c, c])),
    columns,
  );
  const body = matrixRows.map((r) => rowToCsv(r, columns)).join("\n");
  writeFileSync(outPath, `${header}\n${body}\n`, "utf8");

  const disagree = matrixRows.filter((r) => r.policies_disagree_p1_p3 === "yes").length;
  const p1Wrong = matrixRows.filter((r) => r.p1_matches_oracle === "no").length;
  const p3Wrong = matrixRows.filter((r) => r.p3_matches_oracle === "no").length;
  const tierSens = matrixRows.filter((r) => r.tier_sensitive === "yes").length;

  console.log("=== prompt routing matrix ===");
  console.log("prompts:", matrixRows.length);
  console.log("labels:", labels.length, `(${labelsPath})`);
  console.log("both-tier rows indexed:", bothTier.size);
  console.log("policy files:", policyFiles.length);
  for (const f of policyFiles) console.log("  ", f);
  console.log("adequacy files:", adequacyFiles.length);
  for (const f of adequacyFiles) console.log("  ", f);
  const with72b = matrixRows.filter((r) => r.duration_72b_ms !== "").length;
  console.log("rows with 72B adequacy:", with72b);
  console.log("tier_sensitive:", tierSens);
  console.log("p1≠p3 tier:", disagree);
  console.log("p1 oracle mismatches:", p1Wrong);
  console.log("p3 oracle mismatches:", p3Wrong);
  console.log("output:", outPath);
}

main();
