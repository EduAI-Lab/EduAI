#!/usr/bin/env node
/**
 * Smoke test vLLM OpenAI-compatible API.
 *
 * Reads apps/core/.env (same as prisma seed). Or pass inline:
 *   VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001 npm run vllm:smoke
 *   VLLM_MODEL=qwen2.5-32b-instruct npm run vllm:smoke
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const port = process.env.VLLM_PORT || "8001";
const base = (
  process.env.VLLM_BASE_URL || `http://127.0.0.1:${port}`
).replace(/\/$/, "");
const apiKey = process.env.VLLM_API_KEY || "vllm-local";
const model = process.env.VLLM_MODEL || "qwen2.5-7b-instruct";

async function main() {
  if (!process.env.VLLM_BASE_URL) {
    console.error(
      "VLLM_BASE_URL not set. Add to apps/core/.env:\n" +
        '  VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"\n' +
        '  VLLM_API_KEY="vllm-local"'
    );
    process.exit(1);
  }

  const modelsRes = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log("GET /v1/models", modelsRes.status, `→ ${base}`);
  const modelsText = await modelsRes.text();
  if (!modelsRes.ok) {
    console.error(modelsText.slice(0, 2000));
    process.exit(1);
  }
  try {
    const body = JSON.parse(modelsText);
    console.log(JSON.stringify(body, null, 2));
    if (!Array.isArray(body.data) || body.data.length === 0) {
      console.error("GET /v1/models returned no models");
      process.exit(1);
    }
  } catch {
    console.error("GET /v1/models returned invalid JSON:", modelsText.slice(0, 500));
    process.exit(1);
  }

  const t0 = performance.now();
  const chatRes = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Say hi in one word." }],
      max_tokens: 32,
      stream: false,
    }),
  });
  const elapsed = Math.round(performance.now() - t0);
  console.log("\nPOST /v1/chat/completions", chatRes.status, `(${elapsed} ms wall)`);

  const text = await chatRes.text();
  try {
    const json = JSON.parse(text);
    if (!chatRes.ok) {
      console.error("error body:", JSON.stringify(json, null, 2));
    } else {
      const content = json.choices?.[0]?.message?.content;
      console.log("reply:", content);
      console.log("usage:", json.usage);
    }
  } catch {
    console.log(text.slice(0, 2000));
  }

  if (!chatRes.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
