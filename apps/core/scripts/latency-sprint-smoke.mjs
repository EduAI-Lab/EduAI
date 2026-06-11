/**
 * PR #529 / #203 manual smoke checks against dev (or local).
 *
 * Usage (from apps/core):
 *   CHAT_SMOKE_URL=https://dev.eduai.ok.ubc.ca \
 *   CHAT_SMOKE_EMAIL=admin@eduai.local \
 *   CHAT_SMOKE_PASSWORD=... \
 *   node ./scripts/latency-sprint-smoke.mjs
 *
 * Optional:
 *   CHAT_SMOKE_TOOL_MODEL=vllm:qwen2.5-32b-instruct
 *   CHAT_SMOKE_COURSE_CODE="COSC 121"
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const BASE = (process.env.CHAT_SMOKE_URL || "https://dev.eduai.ok.ubc.ca").replace(/\/$/, "");
const EMAIL = process.env.CHAT_SMOKE_EMAIL || "admin@eduai.local";
const PASSWORD = process.env.CHAT_SMOKE_PASSWORD;
const TOOL_MODEL = process.env.CHAT_SMOKE_TOOL_MODEL || "vllm:qwen2.5-32b-instruct";
const COURSE_CODE = process.env.CHAT_SMOKE_COURSE_CODE || "COSC 121";

const MAGIC_PHRASES = [
  "check the course materials",
  "check course materials",
  "please select a course",
  "select a course from",
  "use getinformation",
  "call getinformation",
];

function fail(msg) {
  return { ok: false, msg };
}
function pass(msg) {
  return { ok: true, msg };
}
function skip(msg) {
  return { ok: null, msg };
}

async function login() {
  if (!PASSWORD) {
    throw new Error("Set CHAT_SMOKE_PASSWORD (seed default: EduAI2026! on dev)");
  }
  const body = new URLSearchParams({ email: EMAIL, password: PASSWORD });
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = setCookie.length ? setCookie : [res.headers.get("set-cookie")].filter(Boolean);
  const token = raw
    .flatMap((c) => String(c).split(/,(?=[^;]+?=)/))
    .map((c) => c.trim())
    .find((c) => c.startsWith("__Secure-better-auth.session_token="));
  if (!token) {
    throw new Error(`Login failed — HTTP ${res.status}, no session cookie`);
  }
  return token.split(";")[0];
}

async function postChat(cookie, payload, { streaming = false, timeoutMs = 120_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        apiKeys: {},
        streaming,
        ...payload,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* streaming body */
    }
    return { res, text, json, ms };
  } finally {
    clearTimeout(timer);
  }
}

async function checkWebToolsToggle(cookie) {
  const res = await fetch(`${BASE}/api/system-config/webToolsEnabled`, {
    headers: { Cookie: cookie },
  });
  if (res.status === 403) return fail("webToolsEnabled API returned 403 (not admin?)");
  if (res.status !== 200) return fail(`webToolsEnabled API HTTP ${res.status}`);
  const data = await res.json();
  if (data.webToolsEnabled !== false) {
    return fail(`webToolsEnabled=${data.webToolsEnabled} (expected false by default)`);
  }
  return pass("webToolsEnabled=false via admin API");
}

async function checkWebToolsHeader(cookie) {
  const { res, ms } = await postChat(
    cookie,
    {
      model: TOOL_MODEL,
      messages: [{ id: randomUUID(), role: "user", content: "Reply with exactly: ok" }],
      streaming: true,
    },
    { streaming: true, timeoutMs: 60_000 },
  );
  const flag = res.headers.get("X-Web-Tools-Enabled");
  if (res.status !== 200) return fail(`chat streaming HTTP ${res.status}`);
  if (flag !== "0") return fail(`X-Web-Tools-Enabled=${flag} (expected 0)`);
  return pass(`X-Web-Tools-Enabled=0 on chat stream (${ms} ms)`);
}

async function checkSelectedModelUsed(cookie) {
  const { res, ms } = await postChat(
    cookie,
    {
      model: TOOL_MODEL,
      messages: [
        {
          id: randomUUID(),
          role: "user",
          content: "What is gradient descent? Answer in two sentences.",
        },
      ],
      streaming: true,
    },
    { streaming: true, timeoutMs: 90_000 },
  );
  if (res.status !== 200) return fail(`chat-only HTTP ${res.status}`);
  const routed = res.headers.get("X-Routed-Model");
  if (routed) {
    return fail(`X-Routed-Model=${routed} (server should use the selected model, not route elsewhere)`);
  }
  return pass(`Selected model used with no tier override (${ms} ms)`);
}

async function checkC1AutoRag(cookie) {
  const prompt = "What did chapter 3 say about loops? Summarize in 3 bullet points.";
  const { res, json, text, ms } = await postChat(
    cookie,
    {
      model: TOOL_MODEL,
      courseCode: COURSE_CODE,
      messages: [{ id: randomUUID(), role: "user", content: prompt }],
      streaming: false,
    },
    { timeoutMs: 180_000 },
  );
  if (res.status !== 200) {
    return fail(`C1 chat HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const content = String(json?.content ?? text ?? "");
  if (!content.trim()) return fail(`C1 empty response (${ms} ms)`);
  const lower = content.toLowerCase();
  for (const phrase of MAGIC_PHRASES) {
    if (lower.includes(phrase)) {
      return fail(`C1 still asks for magic phrase: "${phrase}"`);
    }
  }
  const preview = content.replace(/\s+/g, " ").slice(0, 120);
  return pass(`C1 answered without magic phrase (${ms} ms): "${preview}…"`);
}

async function main() {
  console.log("=== #203 latency sprint smoke ===");
  console.log("target:", BASE);
  console.log("tool model:", TOOL_MODEL);
  console.log("course:", COURSE_CODE);
  console.log("");

  const cookie = await login();
  console.log("auth: ok (admin session)\n");

  const checks = [
    ["L13 — webToolsEnabled default OFF (API)", checkWebToolsToggle],
    ["L13 — X-Web-Tools-Enabled header", checkWebToolsHeader],
    ["L10 — selected model (no tier routing)", checkSelectedModelUsed],
    ["L03 — C1 auto-RAG (no magic phrase)", checkC1AutoRag],
  ];

  const results = [];
  for (const [name, fn] of checks) {
    process.stdout.write(`${name} … `);
    try {
      const r = await fn(cookie);
      results.push({ name, ...r });
      const icon = r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "SKIP";
      console.log(`${icon}: ${r.msg}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ name, ok: false, msg });
      console.log(`FAIL: ${msg}`);
    }
  }

  console.log("");
  const failed = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === null);
  console.log(
    `summary: ${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
