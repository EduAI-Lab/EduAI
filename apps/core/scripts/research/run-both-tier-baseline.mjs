#!/usr/bin/env node
/**
 * Step 4 — run task-suite prompts on tier 1 (7B) and tier 3 (32B) vLLM models.
 *
 * Writes append-friendly JSONL rows for LLM-judge labeling (min_adequate_tier).
 *
 * Required env (or reuse CHAT_BENCH_* aliases):
 *   RESEARCH_RUN_URL / CHAT_BENCH_URL     POST target, e.g. https://dev.eduai.ok.ubc.ca/api/chat
 *   RESEARCH_RUN_API_KEYS / CHAT_BENCH_API_KEYS   JSON apiKeys body
 *   RESEARCH_RUN_API_KEYS_FILE / CHAT_BENCH_API_KEYS_FILE  path to JSON file (preferred on server)
 *   RESEARCH_RUN_X_API_KEY / CHAT_BENCH_X_API_KEY  admin key, OR
 *   RESEARCH_RUN_COOKIE / CHAT_BENCH_COOKIE         session cookie
 *
 * Optional:
 *   RESEARCH_TIER1_MODEL   default vllm:qwen2.5-7b-instruct
 *   RESEARCH_TIER3_MODEL   default vllm:qwen2.5-32b-instruct
 *   RESEARCH_RUN_SPLIT     dev | test | all (default dev)
 *   RESEARCH_RUN_LIMIT     max prompts after filter
 *   RESEARCH_RUN_IDS       comma-separated ts-### filter
 *   RESEARCH_RUN_TIERS     comma-separated tier filter (1,3); default both
 *   RESEARCH_RUN_OUT       output JSONL path (default docs/research/data/runs/both-tier.v1.jsonl)
 *   RESEARCH_SUITE_DIR     override task-suite folder (must contain prompts.v1.jsonl)
 *   RESEARCH_RUNS_DIR      override runs output folder
 *   RESEARCH_RUN_SLEEP_MS  delay between requests (default 500)
 *   RESEARCH_RUN_TIMEOUT_MS  per-request timeout (default 180000)
 *   RESEARCH_FORCE_HYBRID=1  force hybrid RAG even for webSearch prompts (debug)
 *
 * Usage:
 *   cd apps/core && npm run research:run-both-tier
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_BOTH_TIER_OUT, PROMPTS_PATH } from "./paths.mjs";
import {
  resolveResearchChatFlags,
  resolveResearchTimeoutMs,
} from "./research-chat-body.mjs";

const TIER_MODELS = [
  { tier: 1, envKey: "RESEARCH_TIER1_MODEL", fallback: "vllm:qwen2.5-7b-instruct" },
  { tier: 3, envKey: "RESEARCH_TIER3_MODEL", fallback: "vllm:qwen2.5-32b-instruct" },
];

function readEnv(primary, alias) {
  for (const name of [primary, alias]) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function loadApiKeysJson() {
  const file = readEnv("RESEARCH_RUN_API_KEYS_FILE", "CHAT_BENCH_API_KEYS_FILE");
  if (file) {
    return readFileSync(file, "utf8").trim();
  }
  return readEnv("RESEARCH_RUN_API_KEYS", "CHAT_BENCH_API_KEYS");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadPrompts() {
  let raw;
  try {
    raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      console.error(`Task suite not found: ${PROMPTS_PATH}`);
      console.error("Copy prompts.v1.jsonl to that path, or set RESEARCH_SUITE_DIR, e.g.:");
      console.error("  RESEARCH_SUITE_DIR=./scripts/research/data/task-suite");
      process.exit(1);
    }
    throw e;
  }
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`prompts.v1.jsonl line ${i + 1}: ${e.message}`);
    }
  });
}

function extractResponseText(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.content === "string") return json.content;
  if (typeof json.text === "string") return json.text;
  if (typeof json.response === "string") return json.response;
  if (Array.isArray(json.messages)) {
    const last = json.messages.at(-1);
    if (last && typeof last.content === "string") return last.content;
  }
  return "";
}

async function postChat({
  url,
  headers,
  apiKeys,
  model,
  prompt,
  courseCode,
  forceHybridRag,
  hybridWebTools,
  timeoutMs,
}) {
  const body = {
    model,
    apiKeys,
    messages: [{ id: randomUUID(), role: "user", content: prompt }],
    streaming: false,
    ...(courseCode ? { courseCode } : {}),
    ...(forceHybridRag ? { forceHybridRag: true } : {}),
    ...(hybridWebTools ? { hybridWebTools: true } : {}),
  };

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    const message = e instanceof Error ? e.message : String(e);
    return {
      httpStatus: 0,
      durationMs,
      responseText: "",
      finishReason: null,
      error: message.includes("TimeoutError") ? `Request timed out after ${timeoutMs}ms` : message,
      routedModel: null,
      forceHybridRag,
    };
  }
  const text = await res.text();
  const durationMs = Math.round(performance.now() - t0);

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }

  return {
    httpStatus: res.status,
    durationMs,
    responseText: extractResponseText(json),
    finishReason: json?.finishReason ?? null,
    error: json?.error ?? (res.status >= 400 ? text.slice(0, 200) : null),
    routedModel: res.headers.get("x-routed-model"),
    forceHybridRag,
  };
}

async function main() {
  const url = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL");
  const apiKeysJson = loadApiKeysJson();
  const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
  const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");
  const splitFilter = (readEnv("RESEARCH_RUN_SPLIT") ?? "dev").toLowerCase();
  const limitRaw = readEnv("RESEARCH_RUN_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;
  const idsFilter = readEnv("RESEARCH_RUN_IDS");
  const outPath = readEnv("RESEARCH_RUN_OUT") ?? DEFAULT_BOTH_TIER_OUT;
  const sleepMs = Math.max(0, Number(readEnv("RESEARCH_RUN_SLEEP_MS", "500")) || 0);
  const label = readEnv("RESEARCH_RUN_LABEL") ?? "both-tier-v1";

  if (!url || !apiKeysJson) {
    console.error(
      "Need RESEARCH_RUN_URL and RESEARCH_RUN_API_KEYS_FILE (or RESEARCH_RUN_API_KEYS / CHAT_BENCH_* equivalents).",
    );
    console.error("See apps/core/.env.research.example");
    process.exit(1);
  }
  if (!xApiKey && !cookie) {
    console.error("Need RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE for auth.");
    process.exit(1);
  }

  let apiKeys;
  try {
    apiKeys = JSON.parse(apiKeysJson);
  } catch {
    console.error("API keys must be valid JSON.");
    console.error("Use RESEARCH_RUN_API_KEYS_FILE=./scripts/research/research-api-keys.json");
    console.error(`Received (${apiKeysJson.length} chars): ${apiKeysJson.slice(0, 120)}…`);
    process.exit(1);
  }

  let tierModels = TIER_MODELS.map(({ tier, envKey, fallback }) => ({
    tier,
    model: readEnv(envKey) ?? fallback,
  }));

  const tiersFilter = readEnv("RESEARCH_RUN_TIERS");
  if (tiersFilter) {
    const allowed = new Set(
      tiersFilter
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => n === 1 || n === 3),
    );
    tierModels = tierModels.filter(({ tier }) => allowed.has(tier));
    if (tierModels.length === 0) {
      console.error("RESEARCH_RUN_TIERS must include 1 and/or 3.");
      process.exit(1);
    }
  }

  let prompts = loadPrompts();
  if (splitFilter !== "all") {
    prompts = prompts.filter((p) => p.split === splitFilter);
  }
  if (idsFilter) {
    const ids = new Set(idsFilter.split(",").map((s) => s.trim()).filter(Boolean));
    prompts = prompts.filter((p) => ids.has(p.id));
  }
  if (limit) {
    prompts = prompts.slice(0, limit);
  }

  if (prompts.length === 0) {
    console.error("No prompts matched filters.");
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const headers = { "Content-Type": "application/json" };
  if (xApiKey) headers["x-api-key"] = xApiKey;
  if (cookie) headers.Cookie = cookie;

  const runStarted = new Date().toISOString();
  const totalCalls = prompts.length * tierModels.length;

  console.log("=== both-tier baseline run ===");
  console.log("label:", label);
  console.log("url:", url);
  console.log("split:", splitFilter);
  console.log("prompts:", prompts.length);
  console.log("tiers:", tierModels.map((t) => `${t.tier}=${t.model}`).join(", "));
  console.log("output:", outPath);
  console.log("total HTTP calls:", totalCalls);
  console.log("");

  const forceHybridAll = readEnv("RESEARCH_FORCE_HYBRID") === "1";

  let callIndex = 0;
  let errors = 0;

  for (const row of prompts) {
    for (const { tier, model } of tierModels) {
      callIndex++;
      const preview =
        row.prompt.length > 55 ? `${row.prompt.slice(0, 52)}…` : row.prompt;
      console.log(
        `[${callIndex}/${totalCalls}] ${row.id} tier ${tier} (${model}) — ${preview}`,
      );

      const hybridFlags = resolveResearchChatFlags(row, { forceHybridAll });

      const result = await postChat({
        url,
        headers,
        apiKeys,
        model,
        prompt: row.prompt,
        courseCode: row.course_code ?? undefined,
        forceHybridRag: hybridFlags.forceHybridRag,
        hybridWebTools: hybridFlags.hybridWebTools,
        timeoutMs: resolveResearchTimeoutMs(readEnv, row),
      });

      if (result.httpStatus >= 400 || result.error) {
        errors++;
        console.log(`  ERROR HTTP ${result.httpStatus}: ${String(result.error).slice(0, 100)}`);
      } else if (!result.responseText) {
        errors++;
        console.log(
          `  WARN empty response (${result.durationMs} ms, finish=${result.finishReason ?? "?"})`,
        );
      } else {
        console.log(
          `  OK ${result.durationMs} ms, ${result.responseText.length} chars (hybrid=${forceHybridRag})`,
        );
      }

      const record = {
        run_label: label,
        run_started: runStarted,
        recorded_at: new Date().toISOString(),
        prompt_id: row.id,
        stratum: row.stratum,
        category: row.category,
        split: row.split,
        rag_context: row.rag_context,
        tools_expected: row.tools_expected,
        course_code: row.course_code,
        prompt: row.prompt,
        tier,
        model,
        force_hybrid_rag: hybridFlags.forceHybridRag,
        hybrid_web_tools: hybridFlags.hybridWebTools,
        tool_execution_mode: hybridFlags.tool_execution_mode,
        routed_model: result.routedModel,
        duration_ms: result.durationMs,
        http_status: result.httpStatus,
        finish_reason: result.finishReason,
        response: result.responseText,
        error: result.error,
      };

      appendFileSync(outPath, `${JSON.stringify(record)}\n`, "utf8");

      if (sleepMs && callIndex < totalCalls) {
        await sleep(sleepMs);
      }
    }
  }

  console.log("");
  console.log("=== done ===");
  console.log("rows written:", totalCalls);
  console.log("errors:", errors);
  console.log("output:", outPath);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
