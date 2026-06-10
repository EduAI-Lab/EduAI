#!/usr/bin/env node
/**
 * Step 5 — run task-suite prompts under routing policy P0 or P1.
 *
 * P0: always tier 3 (vllm:qwen2.5-32b-instruct)
 * P1: Auto routing (model=auto)
 *
 * Env: same as run-both-tier-baseline.mjs plus:
 *   RESEARCH_POLICY          P0 | P1 | both (default both)
 *   RESEARCH_RUN_SPLIT       dev | test | all (default test for step 5)
 *   RESEARCH_POLICY_OUT      default docs/research/data/runs/policy-runs.v1.jsonl
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_POLICY_OUT, PROMPTS_PATH } from "./paths.mjs";

const POLICIES = {
  P0: {
    policy: "P0",
    requested_model: "vllm:qwen2.5-32b-instruct",
    description: "always-large",
  },
  P1: {
    policy: "P1",
    requested_model: "auto",
    description: "rule-based-auto",
  },
};

function readEnv(primary, alias) {
  for (const name of [primary, alias]) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function loadApiKeysJson() {
  const file = readEnv("RESEARCH_RUN_API_KEYS_FILE", "CHAT_BENCH_API_KEYS_FILE");
  if (file) return readFileSync(file, "utf8").trim();
  return readEnv("RESEARCH_RUN_API_KEYS", "CHAT_BENCH_API_KEYS");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadPrompts() {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
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
  return "";
}

function inferTierFromModel(modelId) {
  if (!modelId) return null;
  if (modelId.includes("7b")) return 1;
  if (modelId.includes("32b")) return 3;
  return null;
}

async function postChat({ url, headers, apiKeys, model, prompt, courseCode, forceHybridRag }) {
  const body = {
    model,
    apiKeys,
    messages: [{ id: randomUUID(), role: "user", content: prompt }],
    streaming: false,
    ...(courseCode ? { courseCode } : {}),
    ...(forceHybridRag ? { forceHybridRag: true } : {}),
  };

  const timeoutMs = Math.max(
    30_000,
    Number(readEnv("RESEARCH_RUN_TIMEOUT_MS", "180000")) || 180_000,
  );

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
      error: message,
      routedModel: null,
      routingTier: null,
    };
  }

  const text = await res.text();
  const durationMs = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }

  const routedModel =
    res.headers.get("x-routed-model") ??
    res.headers.get("X-Routed-Model") ??
    json?.model ??
    null;
  const routingTierHeader = res.headers.get("x-routing-tier");
  const routingTier = routingTierHeader
    ? Number(routingTierHeader)
    : inferTierFromModel(routedModel);

  return {
    httpStatus: res.status,
    durationMs,
    responseText: extractResponseText(json),
    finishReason: json?.finishReason ?? null,
    error: json?.error ?? (res.status >= 400 ? text.slice(0, 200) : null),
    routedModel,
    routingTier: Number.isFinite(routingTier) ? routingTier : null,
  };
}

async function main() {
  const url = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL");
  const apiKeysJson = loadApiKeysJson();
  const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
  const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");
  const splitFilter = (readEnv("RESEARCH_RUN_SPLIT") ?? "test").toLowerCase();
  const policyFilter = (readEnv("RESEARCH_POLICY") ?? "both").toUpperCase();
  const limitRaw = readEnv("RESEARCH_RUN_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;
  const idsFilter = readEnv("RESEARCH_RUN_IDS");
  const outPath = readEnv("RESEARCH_POLICY_OUT") ?? DEFAULT_POLICY_OUT;
  const sleepMs = Math.max(0, Number(readEnv("RESEARCH_RUN_SLEEP_MS", "500")) || 0);
  const runLabel = readEnv("RESEARCH_RUN_LABEL") ?? "policy-v1";
  const forceHybridAll = readEnv("RESEARCH_FORCE_HYBRID") === "1";

  if (!url || !apiKeysJson) {
    console.error("Need RESEARCH_RUN_URL and RESEARCH_RUN_API_KEYS(_FILE).");
    process.exit(1);
  }
  if (!xApiKey && !cookie) {
    console.error("Need RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE.");
    process.exit(1);
  }

  const apiKeys = JSON.parse(apiKeysJson);
  const headers = { "Content-Type": "application/json" };
  if (xApiKey) headers["x-api-key"] = xApiKey;
  if (cookie) headers.Cookie = cookie;

  let policies =
    policyFilter === "BOTH"
      ? [POLICIES.P0, POLICIES.P1]
      : [POLICIES[policyFilter]].filter(Boolean);

  if (policies.length === 0) {
    console.error("RESEARCH_POLICY must be P0, P1, or both.");
    process.exit(1);
  }

  let prompts = loadPrompts();
  if (splitFilter !== "all") {
    prompts = prompts.filter((p) => p.split === splitFilter);
  }
  if (idsFilter) {
    const ids = new Set(idsFilter.split(",").map((s) => s.trim()).filter(Boolean));
    prompts = prompts.filter((p) => ids.has(p.id));
  }
  if (limit) prompts = prompts.slice(0, limit);

  if (prompts.length === 0) {
    console.error("No prompts matched filters.");
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const runStarted = new Date().toISOString();
  const totalCalls = prompts.length * policies.length;

  console.log("=== policy comparison run ===");
  console.log("label:", runLabel);
  console.log("url:", url);
  console.log("split:", splitFilter);
  console.log("policies:", policies.map((p) => p.policy).join(", "));
  console.log("prompts:", prompts.length);
  console.log("output:", outPath);
  console.log("total HTTP calls:", totalCalls);
  console.log("");

  let callIndex = 0;
  let errors = 0;

  for (const row of prompts) {
    for (const policy of policies) {
      callIndex++;
      const preview = row.prompt.length > 55 ? `${row.prompt.slice(0, 52)}…` : row.prompt;
      console.log(
        `[${callIndex}/${totalCalls}] ${policy.policy} ${row.id} — ${preview}`,
      );

      const forceHybridRag =
        forceHybridAll ||
        (row.tools_expected !== "webSearch" && row.tools_expected !== "fetchPage");

      const result = await postChat({
        url,
        headers,
        apiKeys,
        model: policy.requested_model,
        prompt: row.prompt,
        courseCode: row.course_code ?? undefined,
        forceHybridRag,
      });

      if (result.httpStatus >= 400 || result.error) {
        errors++;
        console.log(`  ERROR HTTP ${result.httpStatus}: ${String(result.error).slice(0, 100)}`);
      } else if (!result.responseText) {
        errors++;
        console.log(`  WARN empty response (${result.durationMs} ms)`);
      } else {
        console.log(
          `  OK ${result.durationMs} ms, ${result.responseText.length} chars` +
            ` routed=${result.routedModel ?? "?"} tier=${result.routingTier ?? "?"}`,
        );
      }

      appendFileSync(
        outPath,
        `${JSON.stringify({
          run_label: runLabel,
          run_started: runStarted,
          recorded_at: new Date().toISOString(),
          policy: policy.policy,
          policy_description: policy.description,
          requested_model: policy.requested_model,
          prompt_id: row.id,
          stratum: row.stratum,
          category: row.category,
          split: row.split,
          rag_context: row.rag_context,
          tools_expected: row.tools_expected,
          course_code: row.course_code,
          prompt: row.prompt,
          force_hybrid_rag: forceHybridRag,
          routed_model: result.routedModel,
          routing_tier: result.routingTier,
          duration_ms: result.durationMs,
          http_status: result.httpStatus,
          finish_reason: result.finishReason,
          response: result.responseText,
          error: result.error,
        })}\n`,
        "utf8",
      );

      if (sleepMs && callIndex < totalCalls) await sleep(sleepMs);
    }
  }

  console.log("\n=== done ===");
  console.log("rows written:", totalCalls);
  console.log("errors:", errors);
  console.log("output:", outPath);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
