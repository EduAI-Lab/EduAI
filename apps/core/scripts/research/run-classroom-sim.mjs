#!/usr/bin/env node
/**
 * Step 6 — classroom load simulation (concurrent students, one GPU).
 *
 * Sends N student requests in waves of concurrent in-flight calls to mimic
 * a lab session (default: 30 students, 5 concurrent — see SOLUTIONS_PLAN.md).
 *
 * Env (inherits RESEARCH_RUN_* from policy scripts):
 *   RESEARCH_CLASSROOM_STUDENTS     default 30
 *   RESEARCH_CLASSROOM_CONCURRENCY  default 5
 *   RESEARCH_CLASSROOM_POLICY       P0 | P1 | P3b (default P1)
 *   RESEARCH_CLASSROOM_SPLIT        dev | test (default test)
 *   RESEARCH_CLASSROOM_OUT          JSONL output
 *   RESEARCH_CLASSROOM_SUMMARY      text summary
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_CLASSROOM_OUT,
  DEFAULT_CLASSROOM_SUMMARY,
  PROMPTS_PATH,
} from "./paths.mjs";
import { ensureResearchEnergyReady } from "./energy-sidecar.mjs";
import {
  resolveResearchChatFlags,
  resolveResearchTimeoutMs,
} from "./research-chat-body.mjs";

const POLICIES = {
  P0: { policy: "P0", requested_model: "vllm:qwen2.5-32b-instruct" },
  P1: { policy: "P1", requested_model: "auto" },
  P3b: { policy: "P3b", requested_model: "auto-llm" },
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

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
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
    return {
      httpStatus: 0,
      durationMs: Math.round(performance.now() - t0),
      responseText: "",
      error: e instanceof Error ? e.message : String(e),
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
    error: json?.error ?? (res.status >= 400 ? text.slice(0, 200) : null),
    routedModel,
    routingTier: Number.isFinite(routingTier) ? routingTier : null,
  };
}

async function runWave(jobs, concurrency) {
  const results = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((job) => job()));
    results.push(...batchResults);
  }
  return results;
}

function buildSummary({ rows, wallMs, policy, students, concurrency, split }) {
  const ok = rows.filter((r) => !r.error && r.response);
  const durs = ok.map((r) => r.duration_ms).sort((a, b) => a - b);
  const tiers = { 1: 0, 3: 0, null: 0 };
  for (const r of ok) {
    const t = r.routing_tier ?? null;
    tiers[t] = (tiers[t] ?? 0) + 1;
  }

  const lines = [
    "=== Classroom simulation (Step 6) ===",
    `Generated: ${new Date().toISOString()}`,
    `policy: ${policy}`,
    `split: ${split}`,
    `students: ${students}`,
    `concurrency: ${concurrency}`,
    `wall_time_ms: ${wallMs}`,
    "",
    `OK: ${ok.length}/${rows.length}`,
    `errors: ${rows.length - ok.length}`,
    "",
    "Latency (OK only, ms):",
    `  mean: ${durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0}`,
    `  p50: ${percentile(durs, 50)}`,
    `  p95: ${percentile(durs, 95)}`,
    `  max: ${durs.length ? durs[durs.length - 1] : 0}`,
    "",
    `routing_tier: tier1=${tiers[1]} tier3=${tiers[3]} unknown=${tiers.null}`,
    "",
    "Interpretation:",
    "- Compare p50/p95 to sequential Step 5 means (~11s test P1).",
    "- Higher p95 under concurrency indicates GPU queueing on single vLLM host.",
  ];
  return lines.join("\n");
}

async function main() {
  await ensureResearchEnergyReady();

  const url = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL");
  const apiKeysJson = loadApiKeysJson();
  const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
  const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");
  const policyKey = (readEnv("RESEARCH_CLASSROOM_POLICY") ?? "P1").toUpperCase();
  const splitFilter = (readEnv("RESEARCH_CLASSROOM_SPLIT") ?? "test").toLowerCase();
  const students = Math.max(1, Number(readEnv("RESEARCH_CLASSROOM_STUDENTS", "30")) || 30);
  const concurrency = Math.max(
    1,
    Number(readEnv("RESEARCH_CLASSROOM_CONCURRENCY", "5")) || 5,
  );
  const outPath = readEnv("RESEARCH_CLASSROOM_OUT") ?? DEFAULT_CLASSROOM_OUT;
  const summaryPath = readEnv("RESEARCH_CLASSROOM_SUMMARY") ?? DEFAULT_CLASSROOM_SUMMARY;
  const runLabel = readEnv("RESEARCH_RUN_LABEL") ?? "classroom-v1";

  if (!url || !apiKeysJson) {
    console.error("Need RESEARCH_RUN_URL and RESEARCH_RUN_API_KEYS(_FILE).");
    process.exit(1);
  }
  if (!xApiKey && !cookie) {
    console.error("Need RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE.");
    process.exit(1);
  }

  const policy =
    POLICIES[policyKey] ??
    Object.values(POLICIES).find((p) => p.policy.toUpperCase() === policyKey);
  if (!policy) {
    console.error("RESEARCH_CLASSROOM_POLICY must be P0, P1, or P3b.");
    process.exit(1);
  }

  let prompts = loadPrompts().filter((p) => p.split === splitFilter);
  if (!prompts.length) {
    console.error(`No prompts for split=${splitFilter}.`);
    process.exit(1);
  }

  const apiKeys = JSON.parse(apiKeysJson);
  const headers = { "Content-Type": "application/json" };
  if (xApiKey) headers["x-api-key"] = xApiKey;
  if (cookie) headers.Cookie = cookie;

  mkdirSync(dirname(outPath), { recursive: true });

  const runStarted = new Date().toISOString();
  const assignments = Array.from({ length: students }, (_, i) => {
    const promptRow = prompts[i % prompts.length];
    return {
      student_id: i + 1,
      wave: Math.floor(i / concurrency),
      slot_in_wave: i % concurrency,
      ...promptRow,
    };
  });

  console.log("=== classroom simulation ===");
  console.log("label:", runLabel);
  console.log("policy:", policy.policy);
  console.log("split:", splitFilter);
  console.log("students:", students);
  console.log("concurrency:", concurrency);
  console.log("waves:", Math.ceil(students / concurrency));
  console.log("output:", outPath);
  console.log("");

  const wallT0 = performance.now();
  const jobs = assignments.map((row) => async () => {
    const hybridFlags = resolveResearchChatFlags(row);
    const tDispatch = performance.now();
    const result = await postChat({
      url,
      headers,
      apiKeys,
      model: policy.requested_model,
      prompt: row.prompt,
      courseCode: row.course_code ?? undefined,
      forceHybridRag: hybridFlags.forceHybridRag,
      hybridWebTools: hybridFlags.hybridWebTools,
      timeoutMs: resolveResearchTimeoutMs(readEnv, row),
    });

    const record = {
      run_label: runLabel,
      run_started: runStarted,
      recorded_at: new Date().toISOString(),
      sim_type: "classroom",
      policy: policy.policy,
      requested_model: policy.requested_model,
      student_id: row.student_id,
      wave: row.wave,
      slot_in_wave: row.slot_in_wave,
      prompt_id: row.id,
      stratum: row.stratum,
      category: row.category,
      split: row.split,
      tools_expected: row.tools_expected,
      force_hybrid_rag: hybridFlags.forceHybridRag,
      hybrid_web_tools: hybridFlags.hybridWebTools,
      tool_execution_mode: hybridFlags.tool_execution_mode,
      routed_model: result.routedModel,
      routing_tier: result.routingTier,
      duration_ms: result.durationMs,
      queue_proxy_ms: Math.round(performance.now() - tDispatch - result.durationMs),
      http_status: result.httpStatus,
      response: result.responseText,
      error: result.error,
    };

    const status = record.error ? "ERROR" : "OK";
    console.log(
      `[wave ${row.wave} slot ${row.slot_in_wave}] student ${row.student_id} ${row.id} ${status} ${record.duration_ms}ms tier=${record.routing_tier ?? "?"}`,
    );
    return record;
  });

  const rows = await runWave(jobs, concurrency);
  const wallMs = Math.round(performance.now() - wallT0);

  writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

  const summary = buildSummary({
    rows,
    wallMs,
    policy: policy.policy,
    students,
    concurrency,
    split: splitFilter,
  });
  writeFileSync(summaryPath, `${summary}\n`, "utf8");

  console.log("\n" + summary);
  console.log("\noutput:", outPath);
  console.log("summary:", summaryPath);

  const errors = rows.filter((r) => r.error || !r.response).length;
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
