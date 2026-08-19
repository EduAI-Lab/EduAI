#!/usr/bin/env node

/**
 * Authenticated Core/RAG fleet stress harness.
 *
 * The harness deliberately exercises POST /api/chat rather than a vLLM URL.
 * It runs one sequential RAG/context smoke, then closed-loop concurrent
 * first-turn users at the requested ladder. The same user session may be
 * reused across virtual users; raise CHAT_RATE_LIMIT only for a controlled
 * test window when doing that.
 *
 * Required:
 *   FLEET_STRESS_EMAIL, FLEET_STRESS_PASSWORD, FLEET_STRESS_COURSE_ID
 * Optional:
 *   FLEET_STRESS_CORE_URL (default https://dev.eduai.ok.ubc.ca)
 *   FLEET_STRESS_MODEL (default vllm:qwen3.5-2b-instruct)
 *   FLEET_STRESS_MODELS (comma-separated model ids, alternated per user)
 *   FLEET_STRESS_LADDER (default 16,32,64,128,256,512,768,1000)
 *   FLEET_STRESS_STREAMING=1 (default 0; streaming measures TTFT too)
 *   FLEET_STRESS_TIMEOUT_MS (default 300000)
 *   FLEET_STRESS_OUT (default /tmp/fleet-rag-stress.json)
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.FLEET_STRESS_CORE_URL || "https://dev.eduai.ok.ubc.ca").replace(/\/$/, "");
const origin = (process.env.FLEET_STRESS_ORIGIN || baseUrl).replace(/\/$/, "");
const email = process.env.FLEET_STRESS_EMAIL;
const password = process.env.FLEET_STRESS_PASSWORD;
const courseId = process.env.FLEET_STRESS_COURSE_ID;
const defaultModel = process.env.FLEET_STRESS_MODEL || "vllm:qwen3.5-2b-instruct";
const models = (process.env.FLEET_STRESS_MODELS || defaultModel)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ladder = (process.env.FLEET_STRESS_LADDER || "16,32,64,128,256,512,768,1000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const streaming = process.env.FLEET_STRESS_STREAMING === "1";
const timeoutMs = Number(process.env.FLEET_STRESS_TIMEOUT_MS || 300_000);
const outputPath = process.env.FLEET_STRESS_OUT || "/tmp/fleet-rag-stress.json";
const expectedSource = process.env.FLEET_STRESS_EXPECTED_SOURCE || "Fleet router RAG stress fixture";

if (!email || !password || !courseId) {
  throw new Error("FLEET_STRESS_EMAIL, FLEET_STRESS_PASSWORD, and FLEET_STRESS_COURSE_ID are required");
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)]);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  }
  const value = response.headers.get("set-cookie");
  return value ? value.split(/,(?=[^;]+=[^;]+)/).map((part) => part.split(";", 1)[0]).join("; ") : "";
}

async function request(path, options = {}, cookie = "") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
  const headers = { "Content-Type": "application/json", Origin: origin, ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const started = performance.now();
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers, signal: controller.signal });
    let firstByteMs = null;
    let body = "";
    if (streaming && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let first = true;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (first) {
          firstByteMs = Math.round(performance.now() - started);
          first = false;
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } else {
      body = await response.text();
    }
    return {
      response,
      body,
      json: parseJson(body),
      elapsedMs: Math.round(performance.now() - started),
      firstByteMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function signIn() {
  const result = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  if (!result.response.ok) throw new Error(`sign-in failed: HTTP ${result.response.status} ${result.body.slice(0, 300)}`);
  const cookie = responseCookies(result.response);
  if (!cookie) throw new Error("sign-in succeeded without a session cookie");
  return cookie;
}

function message(content) {
  return { id: randomUUID(), role: "user", content };
}

async function chat(cookie, model, content, chatId = undefined) {
  const result = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model,
      courseId,
      messages: [message(content)],
      streaming,
      ...(chatId ? { chatId } : {}),
    }),
  }, cookie);
  const headers = result.response.headers;
  return {
    status: result.response.status,
    elapsedMs: result.elapsedMs,
    firstByteMs: result.firstByteMs,
    chatId: headers.get("x-chat-id") || result.json?.chatId || null,
    fleetServer: headers.get("x-fleet-server"),
    ragChunkCount: result.json?.ragChunkCount ?? null,
    ragTopSimilarity: result.json?.ragTopSimilarity ?? null,
    ragLatencyMs: result.response.headers.get("x-rag-latency-ms")
      ? Number(result.response.headers.get("x-rag-latency-ms"))
      : (result.json?.ragLatencyMs ?? null),
    sources: Array.isArray(result.json?.sources) ? result.json.sources : [],
    responseText: typeof result.json?.content === "string" ? result.json.content.slice(0, 600) : null,
    citationPresent: typeof result.json?.content === "string" && result.json.content.toLowerCase().includes(expectedSource.toLowerCase()),
    error: result.json?.error || result.json?.code || (result.response.ok ? null : result.body.slice(0, 240)),
  };
}

async function smoke(cookie) {
  const first = await chat(
    cookie,
    models[0],
    "According to the course materials, what is the unique fleet-router stress fact? Cite the source title.",
  );
  if (first.status < 200 || first.status >= 300) throw new Error(`RAG smoke first turn failed: ${JSON.stringify(first)}`);
  const followUp = await chat(
    cookie,
    models[Math.min(1, models.length - 1)],
    "What source title did you use for the fact in my previous question?",
    first.chatId,
  );
  if (followUp.status < 200 || followUp.status >= 300) throw new Error(`RAG smoke follow-up failed: ${JSON.stringify(followUp)}`);
  return {
    first,
    followUp,
    contextPreserved: Boolean(first.chatId && first.chatId === followUp.chatId),
    citationVerified: first.citationPresent,
  };
}

async function runLevel(cookie, concurrency) {
  const started = performance.now();
  const rows = await Promise.all(Array.from({ length: concurrency }, (_, index) =>
    chat(
      cookie,
      models[index % models.length],
      "According to the course materials, state the unique fleet-router stress fact in one sentence and cite the source.",
    ).then((row) => ({ index, model: models[index % models.length], ...row }))
      .catch((error) => ({ index, model: models[index % models.length], status: 0, elapsedMs: null, firstByteMs: null, error: String(error) })),
  ));
  const elapsedMs = Math.round(performance.now() - started);
  const successes = rows.filter((row) => row.status >= 200 && row.status < 300);
  const counts = (values) => Object.fromEntries(
    [...new Set(values)].map((key) => [key || "(none)", values.filter((value) => value === key).length]),
  );
  return {
    concurrency,
    requestCount: rows.length,
    elapsedMs,
    successCount: successes.length,
    failureCount: rows.length - successes.length,
    rps: Number((successes.length / (elapsedMs / 1000 || 1)).toFixed(2)),
    latencyMs: {
      p50: percentile(rows.filter((row) => row.elapsedMs != null).map((row) => row.elapsedMs), 50),
      p95: percentile(rows.filter((row) => row.elapsedMs != null).map((row) => row.elapsedMs), 95),
      p99: percentile(rows.filter((row) => row.elapsedMs != null).map((row) => row.elapsedMs), 99),
      ttftP50: percentile(rows.filter((row) => row.firstByteMs != null).map((row) => row.firstByteMs), 50),
      ttftP95: percentile(rows.filter((row) => row.firstByteMs != null).map((row) => row.firstByteMs), 95),
    },
    serverCounts: counts(rows.map((row) => row.fleetServer)),
    modelCounts: counts(rows.map((row) => row.model)),
    statusCounts: counts(rows.map((row) => String(row.status))),
    rag: {
      responsesWithChunks: successes.filter((row) => Number(row.ragChunkCount) > 0).length,
      averageTopSimilarity: successes.length
        ? Number((successes.reduce((sum, row) => sum + Number(row.ragTopSimilarity || 0), 0) / successes.length).toFixed(4))
        : null,
      sourceTitles: [...new Set(successes.flatMap((row) => row.sources.map((source) => source.materialTitle || source.title || "(unknown)")))],
      citationResponses: successes.filter((row) => row.citationPresent).length,
      latencyMs: {
        p50: percentile(successes.filter((row) => row.ragLatencyMs != null).map((row) => row.ragLatencyMs), 50),
        p95: percentile(successes.filter((row) => row.ragLatencyMs != null).map((row) => row.ragLatencyMs), 95),
      },
    },
    errorCounts: counts(rows.map((row) => row.error).filter(Boolean)),
  };
}

const cookie = await signIn();
const smokeResult = await smoke(cookie);
const levels = [];
for (const concurrency of ladder) {
  const level = await runLevel(cookie, concurrency);
  levels.push(level);
  console.log(JSON.stringify(level));
}

const result = {
  timestamp: new Date().toISOString(),
  baseUrl,
  courseId,
  models,
  streaming,
  ladder,
  smoke: smokeResult,
  levels,
};
mkdirSync(outputPath.includes("/") ? outputPath.slice(0, outputPath.lastIndexOf("/")) || "/" : ".", { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`RESULT_FILE=${outputPath}`);
