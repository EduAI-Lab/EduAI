#!/usr/bin/env node
/**
 * LLM-judge: 32B vs 72B adequacy on paired prompts.
 *
 * Pairs:
 *   - 72B from adequacy JSONL (default adequacy-72b-hard-v1.jsonl)
 *   - 32B from both-tier tier-3 and/or adequacy 32B runs
 *
 * Env:
 *   RESEARCH_ADEQUACY_72B_IN
 *   RESEARCH_BOTH_TIER_IN
 *   RESEARCH_ADEQUACY_32B_IN   optional extra 32B adequacy JSONL
 *   RESEARCH_LABEL_OUT         default runs/labels/labels-32b-72b.v1.jsonl
 *   RESEARCH_JUDGE_BASE_URL    default http://cmps01.ok.ubc.ca:8001/v1
 *   RESEARCH_JUDGE_API_KEY     default vllm-local
 *   RESEARCH_JUDGE_MODEL       default qwen2.5-32b-instruct
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadRunRows } from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, RUNS_DIR } from "./paths.mjs";

const JUDGE_SYSTEM = `You are a strict expert evaluator for educational AI tutoring.

Compare the **32B (large tier)** and **72B (XL tier)** answers to the same student prompt.

Scoring rules:
- "adequate" — correct, complete, trustworthy for university learning
- "degraded" — usable but with meaningful gaps or imprecision
- "insufficient" — wrong, hollow, or unsafe to rely on

Mark quality_delta:
- "equivalent" — both adequate and comparable quality
- "32b_better" — 32B clearly stronger
- "72b_better" — 72B clearly stronger
- "incomparable" — one or both missing/unusable

Return ONLY valid JSON:
{
  "tier32_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "tier72_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "32b_better" | "72b_better" | "incomparable",
  "xl_necessary": true | false,
  "rationale": "2-4 sentences"
}

Set xl_necessary=true only when 72B is adequate and 32B is not adequate.`;

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

function truncate(text, max = 6000) {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function parseJudgeJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  return parsed;
}

function index32bRows(bothTierPath, adequacy32Path) {
  const map = new Map();
  if (existsSync(bothTierPath)) {
    for (const row of loadRunRows(bothTierPath, { dedupe: true })) {
      if (row.tier === 3 && row.response) map.set(row.prompt_id, row);
    }
  }
  if (adequacy32Path && existsSync(adequacy32Path)) {
    for (const row of loadJsonl(adequacy32Path)) {
      if (row.response && /32b/i.test(String(row.model ?? ""))) {
        map.set(row.prompt_id, row);
      }
    }
  }
  return map;
}

async function callJudge({ baseUrl, apiKey, model, userPrompt }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Judge HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Judge missing content");
  return parseJudgeJson(content);
}

async function main() {
  const adequacy72Path = readEnv(
    "RESEARCH_ADEQUACY_72B_IN",
    join(RUNS_DIR, "adequacy", "adequacy-72b-hard-v1.jsonl"),
  );
  const bothTierPath = readEnv("RESEARCH_BOTH_TIER_IN", DEFAULT_BOTH_TIER_IN);
  const adequacy32Path = readEnv("RESEARCH_ADEQUACY_32B_IN", "");
  const outPath = readEnv(
    "RESEARCH_LABEL_OUT",
    join(RUNS_DIR, "labels", "labels-32b-72b.v1.jsonl"),
  );
  const judgeBase = readEnv("RESEARCH_JUDGE_BASE_URL", "http://cmps01.ok.ubc.ca:8001/v1");
  const judgeKey = readEnv("RESEARCH_JUDGE_API_KEY", "vllm-local");
  const judgeModel = readEnv("RESEARCH_JUDGE_MODEL", "qwen2.5-32b-instruct");
  const dryRun = readEnv("RESEARCH_LABEL_DRY_RUN") === "1";
  const limit = readEnv("RESEARCH_LABEL_LIMIT")
    ? Number(readEnv("RESEARCH_LABEL_LIMIT"))
    : undefined;

  const rows72 = loadJsonl(adequacy72Path).filter((r) => !r.error && r.response);
  const map32 = index32bRows(bothTierPath, adequacy32Path);

  let candidates = rows72
    .map((r72) => ({ r72, r32: map32.get(r72.prompt_id) ?? null }))
    .filter(({ r32 }) => r32?.response);

  if (limit) candidates = candidates.slice(0, limit);

  console.log("=== 32B vs 72B adequacy judge ===");
  console.log("72B:", adequacy72Path, "rows:", rows72.length);
  console.log("paired:", candidates.length, "missing 32B:", rows72.length - candidates.length);
  console.log("judge:", judgeModel, "@", judgeBase);
  console.log("output:", outPath);

  if (candidates.length === 0) {
    console.log("Nothing to judge.");
    return;
  }

  if (dryRun) {
    for (const { r72 } of candidates) console.log(r72.prompt_id, r72.stratum);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  let labeled = 0;
  let errors = 0;
  let equivalent = 0;
  let xlNecessary = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { r72, r32 } = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] ${r72.prompt_id}`);

    const userPrompt = [
      "## Metadata",
      `prompt_id: ${r72.prompt_id}`,
      `stratum: ${r72.stratum}`,
      `category: ${r72.category}`,
      "",
      "## Student prompt",
      r72.prompt,
      "",
      "## 32B response",
      truncate(r32.response),
      "",
      "## 72B response",
      truncate(r72.response),
    ].join("\n");

    const t0 = performance.now();
    try {
      const judge = await callJudge({
        baseUrl: judgeBase,
        apiKey: judgeKey,
        model: judgeModel,
        userPrompt,
      });
      if (judge.quality_delta === "equivalent") equivalent++;
      if (judge.xl_necessary === true) xlNecessary++;

      appendFileSync(
        outPath,
        `${JSON.stringify({
          label_version: "32b-72b-v1",
          labeled_at: new Date().toISOString(),
          prompt_id: r72.prompt_id,
          stratum: r72.stratum,
          split: r72.split,
          tier32_adequacy: judge.tier32_adequacy,
          tier72_adequacy: judge.tier72_adequacy,
          quality_delta: judge.quality_delta,
          xl_necessary: judge.xl_necessary === true,
          judge_rationale: String(judge.rationale ?? "").trim(),
          judge_model: judgeModel,
          judge_duration_ms: Math.round(performance.now() - t0),
          duration_32b_ms: r32.duration_ms ?? null,
          duration_72b_ms: r72.duration_ms ?? null,
        })}\n`,
        "utf8",
      );
      labeled++;
      console.log(`  delta=${judge.quality_delta} xl_necessary=${judge.xl_necessary}`);
    } catch (e) {
      errors++;
      console.log(`  ERROR: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }
  }

  console.log("\n=== done ===");
  console.log("labeled:", labeled, "errors:", errors);
  console.log("equivalent:", equivalent, "xl_necessary:", xlNecessary);
  if (labeled > 0) {
    console.log(
      "equivalent rate:",
      `${((equivalent / labeled) * 100).toFixed(1)}%`,
    );
  }
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
