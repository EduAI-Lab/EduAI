/**
 * Non-streaming POST /api/chat latency benchmark.
 *
 * Auth (pick one):
 *   - Admin: CHAT_BENCH_X_API_KEY + session implied by API key plugin
 *   - Logged-in user cookie: CHAT_BENCH_COOKIE="better-auth.session_token=..."
 *
 * Required env:
 *   CHAT_BENCH_URL        e.g. http://127.0.0.1:3000/api/chat or https://dev.eduai.ok.ubc.ca/api/chat
 *   CHAT_BENCH_MODEL      e.g. google:gemini-2.0-flash
 *   CHAT_BENCH_API_KEYS   JSON object for request body "apiKeys", e.g. {"google":{"apiKey":"...","isEnabled":true}}
 *   CHAT_BENCH_API_KEYS_FILE  optional path to a .json file (same shape); overrides CHAT_BENCH_API_KEYS if set
 *
 * Optional:
 *   CHAT_BENCH_LABEL      free text printed in summary (e.g. git branch name)
 *   CHAT_BENCH_COURSE_CODE  if set, sent as courseCode (triggers RAG path when keywords match)
 *   CHAT_BENCH_WARMUP=1   one extra request before timing (not counted)
 *   CHAT_BENCH_COUNT=10   default 10
 *   CHAT_BENCH_SLEEP_MS   delay between requests (default 0)
 *
 * Usage:
 *   cd apps/core && node ./scripts/chat-latency-bench.mjs
 *   CHAT_BENCH_LABEL=feature-branch CHAT_BENCH_URL=... CHAT_BENCH_MODEL=... CHAT_BENCH_API_KEYS='{"google":{...}}' node ./scripts/chat-latency-bench.mjs
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const DEFAULT_PROMPTS = [
  "Reply with exactly the word: ok.",
  "What is 19 + 23? Reply with one number only.",
  "Summarize photosynthesis in one sentence.",
  "Name three countries in North America.",
  "What does HTTP stand for?",
  "Explain what a vector database is in two short sentences.",
  "List two differences between lossy and lossless compression.",
  "What is the capital of British Columbia?",
  "Give a one-sentence definition of machine learning.",
  "Rewrite this as a polite sentence: 'send file now'.",
];

function median(values) {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readEnv(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function parseArgs() {
  const out = { label: readEnv("CHAT_BENCH_LABEL") };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--label=")) out.label = a.slice("--label=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const url = readEnv("CHAT_BENCH_URL");
  const model = readEnv("CHAT_BENCH_MODEL");
  const apiKeysFile = readEnv("CHAT_BENCH_API_KEYS_FILE");
  const apiKeysJson = apiKeysFile
    ? readFileSync(apiKeysFile, "utf8").trim()
    : readEnv("CHAT_BENCH_API_KEYS");
  const xApiKey = readEnv("CHAT_BENCH_X_API_KEY");
  const cookie = readEnv("CHAT_BENCH_COOKIE");
  const courseCode = readEnv("CHAT_BENCH_COURSE_CODE");
  const warmup = readEnv("CHAT_BENCH_WARMUP") === "1";
  const count = Math.max(1, Number(readEnv("CHAT_BENCH_COUNT", "10")) || 10);
  const sleepMs = Math.max(0, Number(readEnv("CHAT_BENCH_SLEEP_MS", "0")) || 0);

  if (!url || !model || !apiKeysJson) {
    console.error(
      "Missing env. Need CHAT_BENCH_URL, CHAT_BENCH_MODEL, and CHAT_BENCH_API_KEYS or CHAT_BENCH_API_KEYS_FILE.",
    );
    process.exit(1);
  }
  if (!xApiKey && !cookie) {
    console.error("Need either CHAT_BENCH_X_API_KEY (admin API key) or CHAT_BENCH_COOKIE (browser session).");
    process.exit(1);
  }

  let apiKeys;
  try {
    apiKeys = JSON.parse(apiKeysJson);
  } catch {
    console.error("CHAT_BENCH_API_KEYS must be valid JSON.");
    process.exit(1);
  }

  const prompts = DEFAULT_PROMPTS.slice(0, count);
  if (prompts.length < count) {
    console.error(`Default prompt list has ${DEFAULT_PROMPTS.length} entries; increase prompts or lower CHAT_BENCH_COUNT.`);
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (xApiKey) headers["x-api-key"] = xApiKey;
  if (cookie) headers["Cookie"] = cookie;

  let chatId = null;
  const timingsMs = [];
  const rows = [];

  async function oneRequest(prompt) {
    const messageId = randomUUID();
    const body = {
      model,
      apiKeys,
      messages: [{ id: messageId, role: "user", content: prompt }],
      streaming: false,
      ...(chatId ? { chatId } : {}),
      ...(courseCode ? { courseCode } : {}),
    };

    const t0 = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const t1 = performance.now();
    const ms = t1 - t0;

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }

    if (!chatId && json && typeof json.chatId === "string") {
      chatId = json.chatId;
    }

    return { ms, status: res.status, json, rawLen: text.length };
  }

  if (warmup) {
    await oneRequest("Warmup: reply with the word ping.");
  }

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const { ms, status, json } = await oneRequest(prompt);
    timingsMs.push(ms);
    const err = json?.error || (status >= 400 ? json?.details || textSnippet(json) : "");
    rows.push({ i: i + 1, ms: Math.round(ms), status, err: err ? String(err).slice(0, 120) : "" });
    if (sleepMs) await sleep(sleepMs);
  }

  const label = args.label || "(no label)";
  console.log("\n=== chat latency bench ===");
  console.log("label:", label);
  console.log("url:", url);
  console.log("model:", model);
  console.log("courseCode:", courseCode || "(none)");
  console.log("warmup:", warmup ? "yes" : "no");
  console.log("");

  console.log("| # | ms | HTTP | notes |");
  console.log("|---:|---:|---:|---|");
  for (const r of rows) {
    console.log(`| ${r.i} | ${r.ms} | ${r.status} | ${r.err.replace(/\|/g, "\\|")} |`);
  }

  console.log("");
  console.log("summary");
  console.log("  count:", timingsMs.length);
  console.log("  mean_ms:", Math.round(mean(timingsMs)));
  console.log("  median_ms:", Math.round(median(timingsMs)));
  console.log("  min_ms:", Math.round(Math.min(...timingsMs)));
  console.log("  max_ms:", Math.round(Math.max(...timingsMs)));
  console.log("");
  console.log("tsv (paste into spreadsheet)");
  console.log(["label", "run_index", "ms", "http_status"].join("\t"));
  rows.forEach((r) => console.log([label, r.i, r.ms, r.status].join("\t")));
}

function textSnippet(json) {
  if (!json) return "";
  try {
    return JSON.stringify(json).slice(0, 80);
  } catch {
    return "";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
