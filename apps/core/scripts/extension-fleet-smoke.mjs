#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const baseUrl = (process.env.CORE_SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const serviceKey = process.env.EDUAI_API_KEY;
if (!serviceKey) {
  console.error("EDUAI_API_KEY is required");
  process.exit(1);
}

/** Mirrors apps/core/app/lib/ai/routing/fleet/registry.ts's serverIdFromUrl. */
function serverIdFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const segment = host.split(".")[0];
    return segment || host;
  } catch {
    return url;
  }
}

function parseCommaUrls(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const interactiveHosts = parseCommaUrls(process.env.VLLM_FLEET_CHAT_URLS).map(serverIdFromUrl);
const heavyUrl = process.env.VLLM_FLEET_HEAVY_URL?.trim();
const heavyHost = heavyUrl ? serverIdFromUrl(heavyUrl) : null;

if (interactiveHosts.length === 0) {
  console.error("VLLM_FLEET_CHAT_URLS must configure at least one interactive host");
  process.exit(1);
}

/**
 * Asserts the response was actually served by fleet routing, not just that the
 * HTTP call succeeded — a background request silently falling back to the
 * interactive pool, or bypassing fleet routing entirely, would otherwise still
 * report OK.
 */
async function run(label, routingContext, expectedHosts) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/completion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "vllm:qwen2.5-7b-instruct",
      apiKeys: {},
      systemPrompt: "Answer with only the word OK.",
      messages: [{ role: "user", content: "Health check" }],
      streaming: false,
      maxTokens: 8,
      routingContext,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  const fleetServer = response.headers.get("x-fleet-server");
  const fleetOk = fleetServer != null && expectedHosts.includes(fleetServer);
  const ok = response.ok && fleetOk;
  console.log(
    `${ok ? "OK" : "FAIL"} ${label}: HTTP ${response.status}, ${elapsedMs} ms, fleet=${fleetServer ?? "(header unavailable)"}, expected one of [${expectedHosts.join(", ")}]`,
  );
  if (!response.ok) console.log(body.slice(0, 300));
  else if (!fleetOk) {
    console.log(
      `X-Fleet-Server did not match an expected host — request may have bypassed fleet routing or fallen back to the wrong pool.`,
    );
  }
  return ok;
}

const tutorOk = await run(
  "AI Tutor / interactive",
  { feature: "tutor", jobType: "interactive" },
  interactiveHosts,
);
const questionMakerOk = await run(
  "Question Maker / background",
  { feature: "question-maker", jobType: "background" },
  heavyHost ? [heavyHost] : interactiveHosts,
);

if (!tutorOk || !questionMakerOk) process.exit(1);
