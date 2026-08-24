#!/usr/bin/env node
/**
 * Smoke test Amazon Bedrock's Converse API with Llama 3 Instruct (70B).
 *
 * Reads apps/core/.env (same as prisma seed). Requires:
 *   AWS_BEARER_TOKEN_BEDROCK="<bedrock api key>"
 *   BEDROCK_REGION="us-east-1"   # region your API key/model access is provisioned in
 *
 * Usage:
 *   npm run bedrock:smoke
 *   npm run bedrock:smoke -- "What is the capital of France?"
 *   npm run bedrock:smoke -- --stream "Say hi in one word."
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

const region = process.env.BEDROCK_REGION || "us-east-1";
const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
const modelId = process.env.BEDROCK_MODEL_ID || "meta.llama3-70b-instruct-v1:0";
const argv = process.argv.slice(2).filter((arg) => arg !== "--stream");
const stream = process.argv.includes("--stream");
const prompt = argv[0] || "Say hi in one word.";

function extractStreamText(bytes) {
  const ascii = Buffer.from(bytes).toString("utf8");
  const texts = [];
  for (const match of ascii.matchAll(/"text"\s*:\s*"((?:\\.|[^"])*)"/g)) {
    texts.push(JSON.parse(`"${match[1]}"`));
  }
  return texts.join("");
}

async function main() {
  if (!apiKey) {
    console.error(
      "AWS_BEARER_TOKEN_BEDROCK not set. Add to apps/core/.env:\n" +
        '  AWS_BEARER_TOKEN_BEDROCK="<bedrock api key>"\n' +
        '  BEDROCK_REGION="us-east-1"',
    );
    process.exit(1);
  }

  const action = stream ? "converse-stream" : "converse";
  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/${action}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (stream) {
    headers.Accept = "application/vnd.amazon.eventstream";
  }

  const t0 = performance.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 512, temperature: 0.5 },
    }),
  });
  const elapsed = Math.round(performance.now() - t0);

  console.log(`POST ${endpoint}`, res.status, `(${elapsed} ms wall)`);

  if (stream) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) {
      console.error("error body:", Buffer.from(bytes).toString("utf8").slice(0, 2000));
      process.exit(1);
    }
    const reply = extractStreamText(bytes);
    console.log("reply:", reply || "(no text deltas found in eventstream)");
    console.log("bytes:", bytes.length);
    return;
  }

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) {
      console.error("error body:", JSON.stringify(json, null, 2));
    } else {
      const content = json.output?.message?.content?.[0]?.text;
      console.log("reply:", content);
      console.log("usage:", json.usage);
    }
  } catch {
    console.log(text.slice(0, 2000));
  }

  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
