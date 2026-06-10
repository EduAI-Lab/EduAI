#!/usr/bin/env node
/**
 * Step 4b — LLM-judge labeling for both-tier baseline runs.
 *
 * Judge backends:
 *   RESEARCH_JUDGE_VIA_EDUAI=1  — reuse RESEARCH_RUN_* creds (32B on dev)
 *   RESEARCH_JUDGE_API_KEY      — OpenAI-compatible API
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  isOkRow,
  loadExistingLabelIds,
  loadRunRows,
  pairByPrompt,
} from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, DEFAULT_LABELS_OUT } from "./paths.mjs";

const ADEQUACY = new Set(["adequate", "degraded", "insufficient"]);
const DELTA_ALIASES = {
  tier1_better: "7b_better",
  tier3_better: "32b_better",
  "7b_better": "7b_better",
  "32b_better": "32b_better",
  equivalent: "equivalent",
  incomparable: "incomparable",
};

const JUDGE_SYSTEM = `You are an expert evaluator for educational AI tutoring responses.

Compare two model answers to the same student prompt. Score each answer independently, then compare them.

Use these adequacy levels:
- "adequate" — correct, helpful, and appropriate for a university tutoring context
- "degraded" — mostly helpful but with minor gaps, imprecision, or weak structure; still usable
- "insufficient" — wrong, off-topic, empty, or too weak to trust for learning

For tool-requiring prompts (web search, fetch page): penalize fabricated citations, made-up URLs, or claims of live lookup without evidence.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "tier1_adequacy": "adequate" | "degraded" | "insufficient",
  "tier3_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "7b_better" | "32b_better" | "incomparable",
  "rationale": "2-4 sentences explaining the scores"
}

If tier 3 response is missing or marked unavailable, set tier3_adequacy to "not_available" and quality_delta to "incomparable".`;

function readEnv(primary, alias) {
  for (const name of [primary, alias]) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(text, max = 6000) {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function passesAdequacy(level) {
  return level === "adequate" || level === "degraded";
}

function computeDerived({ tier1Adequacy, tier3Adequacy, tier3Missing }) {
  let minAdequateTier = null;
  if (passesAdequacy(tier1Adequacy)) {
    minAdequateTier = 1;
  } else if (!tier3Missing && passesAdequacy(tier3Adequacy)) {
    minAdequateTier = 3;
  }

  const tierSensitive =
    minAdequateTier === 3 &&
    !passesAdequacy(tier1Adequacy) &&
    !tier3Missing &&
    passesAdequacy(tier3Adequacy);

  return { min_adequate_tier: minAdequateTier, tier_sensitive: tierSensitive };
}

function buildUserPrompt(meta, tier1Row, tier3Row) {
  const tier3Missing = !tier3Row || !isOkRow(tier3Row);
  const tier3Text = tier3Missing
    ? "(not available — request failed or empty response)"
    : tier3Row.response;

  return [
    "## Prompt metadata",
    `prompt_id: ${meta.prompt_id}`,
    `stratum: ${meta.stratum}`,
    `category: ${meta.category}`,
    `rag_context: ${meta.rag_context}`,
    `tools_expected: ${meta.tools_expected}`,
    `course_code: ${meta.course_code ?? "none"}`,
    "",
    "## Student prompt",
    meta.prompt,
    "",
    "## Tier 1 response (7B)",
    truncate(tier1Row?.response ?? ""),
    "",
    "## Tier 3 response (32B)",
    truncate(tier3Text),
    "",
    tier3Missing
      ? "Note: tier 3 response is unavailable; judge tier 1 only and set tier3_adequacy to not_available."
      : "Judge both responses independently, then set quality_delta.",
  ].join("\n");
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

  // vLLM judges often emit LaTeX/backslashes that break JSON.parse
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

  const tier1 = pick("tier1_adequacy");
  const tier3 = pick("tier3_adequacy");
  const delta = pick("quality_delta");
  const rationale = pick("rationale");
  if (!tier1 || !tier3 || !delta || !rationale) {
    throw new Error(`Judge returned non-JSON: ${slice.slice(0, 200)}`);
  }
  return { tier1_adequacy: tier1, tier3_adequacy: tier3, quality_delta: delta, rationale };
}

function parseJudgeJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned non-JSON: ${trimmed.slice(0, 200)}`);
  }

  const parsed = repairJsonSlice(trimmed.slice(start, end + 1));

  if (!ADEQUACY.has(parsed.tier1_adequacy)) {
    throw new Error(`Invalid tier1_adequacy: ${parsed.tier1_adequacy}`);
  }
  const t3 = parsed.tier3_adequacy;
  if (t3 !== "not_available" && !ADEQUACY.has(t3)) {
    throw new Error(`Invalid tier3_adequacy: ${t3}`);
  }

  const rawDelta = String(parsed.quality_delta ?? "").trim();
  const delta = DELTA_ALIASES[rawDelta] ?? rawDelta;
  if (!["equivalent", "7b_better", "32b_better", "incomparable"].includes(delta)) {
    throw new Error(`Invalid quality_delta: ${parsed.quality_delta}`);
  }

  if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) {
    throw new Error("Missing rationale");
  }

  return { ...parsed, quality_delta: delta };
}

function extractResponseText(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.content === "string") return json.content;
  if (typeof json.text === "string") return json.text;
  if (typeof json.response === "string") return json.response;
  return "";
}

function loadApiKeysJson() {
  const file = readEnv("RESEARCH_RUN_API_KEYS_FILE", "CHAT_BENCH_API_KEYS_FILE");
  if (file) return readFileSync(file, "utf8").trim();
  return readEnv("RESEARCH_RUN_API_KEYS", "CHAT_BENCH_API_KEYS");
}

async function callJudgeOpenAI({ baseUrl, apiKey, model, userPrompt }) {
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
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Judge HTTP ${res.status}: ${text.slice(0, 300)}`);

  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Judge response missing message content");
  return parseJudgeJson(content);
}

async function callJudgeViaEduai({ url, headers, apiKeys, model, userPrompt }) {
  const judgePrompt = `${JUDGE_SYSTEM}\n\n${userPrompt}\n\nRespond with JSON only.`;
  const timeoutMs = Math.max(
    30_000,
    Number(readEnv("RESEARCH_LABEL_TIMEOUT_MS", "180000")) || 180_000,
  );

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

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`EduAI judge non-JSON body: ${text.slice(0, 200)}`);
  }

  const content = extractResponseText(json);
  if (!content) {
    throw new Error(`EduAI judge empty response (finish=${json?.finishReason ?? "?"})`);
  }
  return parseJudgeJson(content);
}

async function main() {
  const inPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_BOTH_TIER_IN;
  const outPath = readEnv("RESEARCH_LABEL_OUT") ?? DEFAULT_LABELS_OUT;
  const viaEduai = readEnv("RESEARCH_JUDGE_VIA_EDUAI") === "1";
  const judgeModel =
    readEnv("RESEARCH_JUDGE_MODEL") ??
    (viaEduai ? "vllm:qwen2.5-32b-instruct" : "gpt-4o-mini");
  const judgeBaseUrl = readEnv("RESEARCH_JUDGE_BASE_URL") ?? "https://api.openai.com/v1";
  const judgeApiKey = readEnv("RESEARCH_JUDGE_API_KEY", "OPENAI_API_KEY");
  const dryRun = readEnv("RESEARCH_LABEL_DRY_RUN") === "1";
  const limitRaw = readEnv("RESEARCH_LABEL_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;
  const idsFilter = readEnv("RESEARCH_LABEL_IDS");
  const sleepMs = Math.max(0, Number(readEnv("RESEARCH_LABEL_SLEEP_MS", "300")) || 0);
  const labelVersion = readEnv("RESEARCH_LABEL_VERSION") ?? "v1";

  let eduaiConfig = null;
  if (viaEduai) {
    const url = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL");
    const apiKeysJson = loadApiKeysJson();
    const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
    const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");
    if (!url || !apiKeysJson) {
      console.error("RESEARCH_JUDGE_VIA_EDUAI=1 needs RESEARCH_RUN_URL and RESEARCH_RUN_API_KEYS(_FILE).");
      process.exit(1);
    }
    if (!xApiKey && !cookie) {
      console.error("RESEARCH_JUDGE_VIA_EDUAI=1 needs RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE.");
      process.exit(1);
    }
    eduaiConfig = {
      url,
      headers: {
        "Content-Type": "application/json",
        ...(xApiKey ? { "x-api-key": xApiKey } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      apiKeys: JSON.parse(apiKeysJson),
    };
  } else if (!dryRun && !judgeApiKey) {
    console.error(
      "Need RESEARCH_JUDGE_API_KEY, RESEARCH_JUDGE_VIA_EDUAI=1, or RESEARCH_LABEL_DRY_RUN=1.",
    );
    process.exit(1);
  }

  const rows = loadRunRows(inPath, { dedupe: true });
  const pairs = pairByPrompt(rows);
  const existingIds = loadExistingLabelIds(outPath);

  let candidates = [...pairs.entries()]
    .map(([promptId, tiers]) => {
      const t1 = tiers[1];
      const t3 = tiers[3];
      const meta = t1 ?? t3;
      return { promptId, t1, t3, meta };
    })
    .filter(({ meta, t1 }) => meta && t1 && isOkRow(t1))
    .sort((a, b) => a.promptId.localeCompare(b.promptId));

  if (idsFilter) {
    const ids = new Set(idsFilter.split(",").map((s) => s.trim()).filter(Boolean));
    candidates = candidates.filter(({ promptId }) => ids.has(promptId));
  }

  candidates = candidates.filter(({ promptId }) => !existingIds.has(promptId));

  if (limit) candidates = candidates.slice(0, limit);

  const bothOk = candidates.filter(({ t1, t3 }) => isOkRow(t1) && isOkRow(t3)).length;

  console.log("=== both-tier LLM judge ===");
  console.log("input:", inPath);
  console.log("output:", outPath);
  console.log("judge:", judgeModel);
  console.log("backend:", viaEduai ? "eduai" : "openai-compatible");
  console.log("candidates:", candidates.length, `(both OK: ${bothOk})`);
  console.log("skip already labeled:", existingIds.size);
  console.log("");

  if (candidates.length === 0) {
    console.log("Nothing to label.");
    return;
  }

  if (dryRun) {
    for (const { promptId, t1, t3 } of candidates) {
      console.log(
        promptId,
        t1.stratum,
        isOkRow(t3) ? "paired" : "tier3-missing",
      );
    }
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });

  let labeled = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { promptId, t1, t3, meta } = candidates[i];
    const tier3Missing = !t3 || !isOkRow(t3);
    console.log(`[${i + 1}/${candidates.length}] ${promptId} (${meta.stratum})`);

    const userPrompt = buildUserPrompt(meta, t1, t3);
    const t0 = performance.now();

    try {
      const judge = viaEduai
        ? await callJudgeViaEduai({ ...eduaiConfig, model: judgeModel, userPrompt })
        : await callJudgeOpenAI({
            baseUrl: judgeBaseUrl,
            apiKey: judgeApiKey,
            model: judgeModel,
            userPrompt,
          });

      const tier3Adequacy =
        tier3Missing || judge.tier3_adequacy === "not_available"
          ? "missing"
          : judge.tier3_adequacy;

      const derived = computeDerived({
        tier1Adequacy: judge.tier1_adequacy,
        tier3Adequacy: tier3Missing ? "insufficient" : judge.tier3_adequacy,
        tier3Missing,
      });

      appendFileSync(
        outPath,
        `${JSON.stringify({
          label_version: labelVersion,
          labeled_at: new Date().toISOString(),
          run_label: t1.run_label ?? t3?.run_label ?? null,
          prompt_id: promptId,
          stratum: meta.stratum,
          category: meta.category,
          split: meta.split,
          rag_context: meta.rag_context,
          tools_expected: meta.tools_expected,
          course_code: meta.course_code ?? null,
          prompt: meta.prompt,
          tier1_adequacy: judge.tier1_adequacy,
          tier3_adequacy: tier3Adequacy,
          min_adequate_tier: derived.min_adequate_tier,
          tier_sensitive: derived.tier_sensitive,
          quality_delta: tier3Missing ? "incomparable" : judge.quality_delta,
          judge_rationale: judge.rationale.trim(),
          judge_model: judgeModel,
          judge_backend: viaEduai ? "eduai" : "openai-compatible",
          tier3_missing: tier3Missing,
          tier1_duration_ms: t1.duration_ms ?? null,
          tier3_duration_ms: tier3Missing ? null : t3.duration_ms ?? null,
          judge_duration_ms: Math.round(performance.now() - t0),
        })}\n`,
        "utf8",
      );
      labeled++;
      console.log(
        `  min_tier=${derived.min_adequate_tier ?? "null"} sensitive=${derived.tier_sensitive}`,
      );
    } catch (e) {
      errors++;
      console.log(`  ERROR: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }

    if (sleepMs && i + 1 < candidates.length) await sleep(sleepMs);
  }

  console.log("\n=== done ===");
  console.log("labeled:", labeled, "errors:", errors, "output:", outPath);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
