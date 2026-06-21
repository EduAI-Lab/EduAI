#!/usr/bin/env node
/** Quick POST probe for research env. Usage: node scripts/research/research-probe.mjs */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function readEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function readJsonFile(path) {
  let raw = readFileSync(path, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw.trim());
}

const url = readEnv("RESEARCH_RUN_URL", "https://dev.eduai.ok.ubc.ca/api/chat");
const model = readEnv("RESEARCH_FIXED_MODEL", "openai:google/gemini-2.5-flash");
const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", readEnv("CHAT_BENCH_X_API_KEY"));
const cookie = readEnv("RESEARCH_RUN_COOKIE");
const keysFile = readEnv("RESEARCH_RUN_API_KEYS_FILE");
let apiKeys = {};
if (keysFile) {
  apiKeys = readJsonFile(keysFile);
} else if (process.env.RESEARCH_RUN_API_KEYS) {
  apiKeys = JSON.parse(process.env.RESEARCH_RUN_API_KEYS);
}

const headers = { "Content-Type": "application/json" };
if (xApiKey) headers["x-api-key"] = xApiKey;
if (cookie) headers.Cookie = cookie;

const baseUrl = url.replace(/\/api\/chat\/?$/, "");

async function checkAuth() {
  if (!xApiKey && !cookie) {
    console.warn("WARN: no RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE — requests may fail auth.");
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/api/ai-providers`, {
      headers: xApiKey ? { "x-api-key": xApiKey } : { Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("AUTH CHECK FAILED:", res.status, text.slice(0, 300));
      if (text.includes("Invalid API key")) {
        console.error(
          "Hint: RESEARCH_RUN_X_API_KEY must be a better-auth admin API key (from dev Settings),",
        );
        console.error("  not EDUAI_API_KEY (service Bearer key). Or set RESEARCH_RUN_COOKIE.");
      }
      process.exit(1);
    }
    console.log("auth check: OK");
  } catch (e) {
    console.warn("auth check skipped:", e instanceof Error ? e.message : e);
  }
}

console.log("POST", url);
console.log("model:", model);
console.log("admin key:", Boolean(xApiKey));
console.log("cookie:", Boolean(cookie));
console.log("apiKeys providers:", Object.keys(apiKeys).join(", ") || "(none)");

await checkAuth();

try {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      apiKeys,
      streaming: false,
      forceHybridRag: true,
      messages: [{ id: randomUUID(), role: "user", content: "Reply with exactly: ok" }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  console.log("HTTP", res.status);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(text.slice(0, 2000));
  }
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
  console.error("FAIL:", e instanceof Error ? e.message : e, cause);
  process.exit(1);
}
