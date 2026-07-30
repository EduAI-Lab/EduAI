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

async function run(label, routingContext) {
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
  const fleetServer = response.headers.get("x-fleet-server") || "(header unavailable)";
  console.log(
    `${response.ok ? "OK" : "FAIL"} ${label}: HTTP ${response.status}, ${elapsedMs} ms, fleet=${fleetServer}`,
  );
  if (!response.ok) console.log(body.slice(0, 300));
  return response.ok;
}

const tutorOk = await run("AI Tutor / interactive", {
  feature: "tutor",
  jobType: "interactive",
});
const questionMakerOk = await run("Question Maker / background", {
  feature: "question-maker",
  jobType: "background",
});

if (!tutorOk || !questionMakerOk) process.exit(1);
