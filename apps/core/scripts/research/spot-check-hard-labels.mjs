#!/usr/bin/env node
/**
 * Stricter re-judge on a fixed set of hard dev prompts to validate min_adequate_tier labels.
 *
 * RESEARCH_SPOT_CHECK_OUT — JSONL (default hard-spot-check.v1.jsonl)
 * RESEARCH_SPOT_CHECK_SUMMARY — text summary (default hard-spot-check-summary.v1.txt)
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { isOkRow, loadRunRows, pairByPrompt } from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, DEFAULT_LABELS_OUT, resolveRunsFile } from "./paths.mjs";

const DEFAULT_SPOT_IDS = [
  "ts-037",
  "ts-038",
  "ts-039",
  "ts-041",
  "ts-042",
  "ts-045",
  "ts-106",
  "ts-111",
  "ts-112",
  "ts-118",
];

const STRICT_JUDGE_SYSTEM = `You are a strict expert evaluator for educational AI tutoring.

Compare tier-1 (7B) and tier-3 (32B) answers to the same student prompt.

Scoring rules (be conservative — prefer tier 3 when quality differs):
- "adequate" — correct, complete, and trustworthy for university learning
- "degraded" — usable but with meaningful gaps or imprecision
- "insufficient" — wrong, hollow, or unsafe to rely on

For min_adequate_tier: use 1 ONLY if tier-1 is adequate on its own; use 3 if tier-3 is needed for adequacy.
Mark tier_sensitive=true when the better tier is not "equivalent" AND at least one tier is adequate.

Return ONLY JSON:
{
  "tier1_adequacy": "adequate" | "degraded" | "insufficient",
  "tier3_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "7b_better" | "32b_better" | "incomparable",
  "min_adequate_tier": 1 | 3,
  "tier_sensitive": true | false,
  "rationale": "2-4 sentences"
}`;

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path) {
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

function repairJsonSlice(slice) {
  let s = slice
    .replace(/\btier1_better\b/g, "7b_better")
    .replace(/\btier3_better\b/g, "32b_better");

  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }

  s = s.replace(/\\(?![\\/"bfnrtu])/g, "\\\\");
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }

  const pick = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const m = s.match(re);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
  };
  const pickNum = (key) => {
    const m = s.match(new RegExp(`"${key}"\\s*:\\s*([13])`));
    return m ? Number(m[1]) : null;
  };
  const pickBool = (key) => {
    const m = s.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`));
    return m ? m[1] === "true" : null;
  };

  const tier1 = pick("tier1_adequacy");
  const tier3 = pick("tier3_adequacy");
  const delta = pick("quality_delta");
  const rationale = pick("rationale");
  if (!tier1 || !tier3 || !delta || !rationale) {
    throw new Error(`Judge returned non-JSON: ${slice.slice(0, 200)}`);
  }
  return {
    tier1_adequacy: tier1,
    tier3_adequacy: tier3,
    quality_delta: delta,
    rationale,
    min_adequate_tier: pickNum("min_adequate_tier"),
    tier_sensitive: pickBool("tier_sensitive"),
  };
}

function parseJudgeJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  return repairJsonSlice(trimmed.slice(start, end + 1));
}

function loadApiKeysJson() {
  const file = readEnv("RESEARCH_RUN_API_KEYS_FILE");
  if (file) return readFileSync(file, "utf8").trim();
  return readEnv("RESEARCH_RUN_API_KEYS");
}

async function callJudgeViaEduai({ url, headers, apiKeys, model, userPrompt }) {
  const judgePrompt = `${STRICT_JUDGE_SYSTEM}\n\n${userPrompt}\n\nRespond with JSON only.`;
  const timeoutMs = Math.max(30_000, Number(readEnv("RESEARCH_LABEL_TIMEOUT_MS")) || 180_000);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      apiKeys,
      messages: [{ id: randomUUID(), role: "user", content: judgePrompt }],
      streaming: false,
      forceHybridRag: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`EduAI judge HTTP ${res.status}: ${text.slice(0, 300)}`);

  const json = JSON.parse(text);
  const content =
    typeof json.content === "string"
      ? json.content
      : typeof json.text === "string"
        ? json.text
        : "";
  if (!content) throw new Error("Empty judge response");
  return parseJudgeJson(content);
}

function buildUserPrompt({ row, tier1, tier3 }) {
  return `Prompt ID: ${row.prompt_id}
Stratum: ${row.stratum}
Category: ${row.category}
Tools expected: ${row.tools_expected}

Student prompt:
${row.prompt}

Tier 1 (7B) response:
${tier1?.response ?? "[missing]"}

Tier 3 (32B) response:
${tier3?.response ?? "[missing]"}`;
}

async function main() {
  const runsPath = readEnv("RESEARCH_SPOT_CHECK_IN") ?? DEFAULT_BOTH_TIER_IN;
  const labelsPath = readEnv("RESEARCH_LABEL_REF") ?? DEFAULT_LABELS_OUT;
  const outPath = readEnv("RESEARCH_SPOT_CHECK_OUT") ?? resolveRunsFile("hard-spot-check.v1.jsonl");
  const summaryPath =
    readEnv("RESEARCH_SPOT_CHECK_SUMMARY") ?? resolveRunsFile("hard-spot-check-summary.v1.txt");

  const ids = (readEnv("RESEARCH_SPOT_CHECK_IDS") ?? DEFAULT_SPOT_IDS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const url = readEnv("RESEARCH_RUN_URL");
  const apiKeysJson = loadApiKeysJson();
  const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY");
  const cookie = readEnv("RESEARCH_RUN_COOKIE");
  const judgeModel = readEnv("RESEARCH_JUDGE_MODEL") ?? "vllm:qwen2.5-32b-instruct";

  if (!url || !apiKeysJson || (!xApiKey && !cookie)) {
    console.error("Need RESEARCH_RUN_URL, API keys, and x-api-key or cookie.");
    process.exit(1);
  }

  const rows = loadRunRows(runsPath).filter((r) => ids.includes(r.prompt_id));
  const pairs = pairByPrompt(rows);
  const priorLabels = new Map(loadJsonl(labelsPath).map((l) => [l.prompt_id, l]));

  const headers = { "Content-Type": "application/json" };
  if (xApiKey) headers["x-api-key"] = xApiKey;
  if (cookie) headers.Cookie = cookie;
  const apiKeys = JSON.parse(apiKeysJson);

  mkdirSync(dirname(outPath), { recursive: true });

  const summaryLines = [
    "=== Hard prompt spot-check (strict judge) ===",
    `Generated: ${new Date().toISOString()}`,
    `prompts: ${ids.length}`,
    "",
  ];

  let agreeTier = 0;
  let disagreeTier = 0;
  let strictSensitive = 0;

  for (const id of ids) {
    const tiers = pairs.get(id);
    if (!tiers) {
      console.warn(`Skip ${id}: missing baseline pair`);
      continue;
    }

    const tier1 = isOkRow(tiers[1]) ? tiers[1] : null;
    const tier3 = isOkRow(tiers[3]) ? tiers[3] : null;
    const meta = tier1 ?? tier3;
    const userPrompt = buildUserPrompt({
      row: {
        prompt_id: id,
        stratum: meta.stratum,
        category: meta.category,
        tools_expected: meta.tools_expected,
        prompt: meta.prompt,
      },
      tier1,
      tier3,
    });

    console.log(`Judging ${id}...`);
    const t0 = performance.now();
    let judge;
    let error = null;
    try {
      judge = await callJudgeViaEduai({
        url,
        headers,
        apiKeys,
        model: judgeModel,
        userPrompt,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const durationMs = Math.round(performance.now() - t0);

    const prior = priorLabels.get(id);
    const record = {
      prompt_id: id,
      judge_version: "strict-v1",
      duration_ms: durationMs,
      prior_min_adequate_tier: prior?.min_adequate_tier ?? null,
      prior_tier_sensitive: prior?.tier_sensitive ?? null,
      strict: judge ?? null,
      error,
    };
    appendFileSync(outPath, `${JSON.stringify(record)}\n`, "utf8");

    if (judge && prior) {
      if (judge.min_adequate_tier === prior.min_adequate_tier) agreeTier++;
      else disagreeTier++;
      if (judge.tier_sensitive) strictSensitive++;
      summaryLines.push(
        `${id}: prior_tier=${prior.min_adequate_tier} strict_tier=${judge.min_adequate_tier} strict_sensitive=${judge.tier_sensitive}`,
      );
    } else if (error) {
      summaryLines.push(`${id}: ERROR ${error}`);
    }
  }

  summaryLines.push("");
  summaryLines.push(`agree min_adequate_tier: ${agreeTier}/${agreeTier + disagreeTier}`);
  summaryLines.push(`disagree: ${disagreeTier}`);
  summaryLines.push(`strict tier_sensitive: ${strictSensitive}/${ids.length}`);
  summaryLines.push(`output: ${outPath}`);

  writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");
  console.log(summaryLines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
