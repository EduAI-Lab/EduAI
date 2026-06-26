#!/usr/bin/env node
/**
 * Admin chatbot smoke test — run from apps/core:
 *   node scripts/admin-chat-smoke.mjs
 *   BASE_URL=https://dev.eduai.ok.ubc.ca node scripts/admin-chat-smoke.mjs
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@eduai.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "EduAI2026!";
const STUDENT_EMAIL = process.env.SMOKE_STUDENT_EMAIL ?? "student1@eduai.local";

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name} — ${detail}`);
}

function parseCookies(setCookieHeaders) {
  const jar = new Map();
  for (const header of setCookieHeaders) {
    const part = header.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) {
      jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function signIn(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  const cookies = parseCookies(res.headers.getSetCookie?.() ?? []);
  const text = await res.text();
  return { status: res.status, cookies, text: text.slice(0, 200) };
}

async function getToolModel(cookies) {
  const res = await fetch(`${BASE_URL}/api/ai-models`, {
    headers: { Cookie: cookieHeader(cookies) },
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  const models = Array.isArray(data) ? data : data.models ?? [];
  const toolModel = models.find((m) => m.supportsTools && m.isActive);
  if (!toolModel?.provider?.name || !toolModel?.modelId) {
    return null;
  }
  return `${toolModel.provider.name}:${toolModel.modelId}`;
}

async function postAdminChat(cookies, body) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookies),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* stream or plain text */
  }
  return { status: res.status, json, text: text.slice(0, 500) };
}

async function runHttpSmoke() {
  console.log(`\n=== HTTP smoke (${BASE_URL}) ===\n`);

  const adminLogin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminLogin.status !== 200 || adminLogin.cookies.size === 0) {
    fail("admin sign-in", `status=${adminLogin.status} body=${adminLogin.text}`);
    return null;
  }
  pass("admin sign-in", ADMIN_EMAIL);

  const emptyAdmin = await postAdminChat(adminLogin.cookies, {
    chatMode: "admin",
    messages: [],
    apiKeys: {},
    streaming: false,
  });
  if (emptyAdmin.status === 200) {
    pass("admin chatMode empty messages", `chatId=${emptyAdmin.json?.chatId ?? "null"}`);
  } else {
    fail("admin chatMode empty messages", `status=${emptyAdmin.status} ${emptyAdmin.text}`);
  }

  const studentLogin = await signIn(STUDENT_EMAIL, ADMIN_PASSWORD);
  if (studentLogin.status === 200 && studentLogin.cookies.size > 0) {
    const forbidden = await postAdminChat(studentLogin.cookies, {
      chatMode: "admin",
      messages: [],
      apiKeys: {},
      streaming: false,
    });
    if (forbidden.status === 403) {
      pass("student blocked from admin chat", "403 Forbidden");
    } else {
      fail("student blocked from admin chat", `expected 403 got ${forbidden.status}`);
    }
  } else {
    fail("student sign-in", `status=${studentLogin.status}`);
  }

  const model = await getToolModel(adminLogin.cookies);
  if (!model) {
    fail("tool-capable model registered", "none found in /api/ai-models");
    return adminLogin.cookies;
  }
  pass("tool-capable model", model);

  const probe = await postAdminChat(adminLogin.cookies, {
    chatMode: "admin",
    model,
    apiKeys: {},
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content: "List all platform users with role and active status. Use listUsers only.",
      },
    ],
    streaming: false,
  });
  const reply = probe.json?.text ?? probe.json?.content;
  if (probe.status === 200 && typeof reply === "string" && reply.length > 0) {
    pass("admin chat LLM round-trip", `reply length=${reply.length}`);
  } else if (probe.status === 502) {
    fail("admin chat LLM round-trip", probe.json?.error ?? probe.text);
  } else {
    fail("admin chat LLM round-trip", `status=${probe.status} ${probe.text}`);
  }

  return adminLogin.cookies;
}

function runToolSmoke() {
  console.log(`\n=== Direct tool smoke ===\n`);

  const child = spawnSync("npx", ["tsx", "scripts/admin-chat-tools-smoke.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
    env: process.env,
  });

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  if (child.status === 0) {
    pass("direct admin write tools", "all checks passed");
  } else {
    fail("direct admin write tools", child.stderr?.slice(0, 300) || `exit ${child.status}`);
  }
}

async function main() {
  console.log("Admin chatbot smoke test");
  await runHttpSmoke();
  runToolSmoke();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
