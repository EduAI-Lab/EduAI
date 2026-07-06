#!/usr/bin/env node
/** One-shot P1 routing telemetry smoke — reads RESEARCH_RUN_* env like run-policy-comparison.mjs */
import { readFileSync } from "node:fs";
import { extractRoutingMetrics } from "./research-routing-metrics.mjs";

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

const url = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL") ?? "http://127.0.0.1:3000/api/chat";
const apiKeysJson = loadApiKeysJson();
const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
const serviceKey = readEnv("EDUAI_API_KEY");
const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");

const headers = { "Content-Type": "application/json" };
if (cookie) {
  headers.Cookie = cookie;
} else if (serviceKey) {
  headers.Authorization = `Bearer ${serviceKey}`;
} else if (xApiKey) {
  headers["x-api-key"] = xApiKey;
}
if (!cookie && !serviceKey && !xApiKey) {
  console.error("Need RESEARCH_RUN_COOKIE, EDUAI_API_KEY, or RESEARCH_RUN_X_API_KEY");
  process.exit(1);
}

const apiKeys = apiKeysJson ? JSON.parse(apiKeysJson) : undefined;
const prompt =
  process.env.SMOKE_PROMPT ??
  "What is decomposition in computational thinking?";

const res = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: "auto",
    apiKeys,
    messages: [{ id: "smoke-routing", role: "user", content: prompt }],
    streaming: false,
    forceHybridRag: true,
  }),
});

const text = await res.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  /* ignore */
}

const metrics = extractRoutingMetrics(json, res.headers);
const headerLines = [];
for (const [k, v] of res.headers.entries()) {
  if (/router|routing|rag-prefetch|route-|model-decode|chat-duration/i.test(k)) {
    headerLines.push(`${k}: ${v}`);
  }
}

console.log(
  JSON.stringify(
    {
      http_status: res.status,
      routed_model: metrics.routed_model,
      routing_tier: metrics.routing_tier,
      router_version: metrics.router_version,
      router_rule: metrics.router_rule,
      route_classify_ms: metrics.route_classify_ms,
      rag_prefetch_ms: metrics.rag_prefetch_ms,
      route_resolve_ms: metrics.route_resolve_ms,
      model_decode_ms: metrics.model_decode_ms,
      duration_ms: metrics.duration_ms,
      response_headers: headerLines,
      error: json?.error ?? (res.status >= 400 ? text.slice(0, 300) : null),
    },
    null,
    2,
  ),
);
