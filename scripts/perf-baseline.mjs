#!/usr/bin/env node
/**
 * perf-baseline.mjs — Issue #961 endpoint response-time baseline.
 *
 * Captures a BEFORE snapshot of the FULL in-scope CRUD API surface across all
 * three apps (Core, AI-Tutor, Question Maker) — every read AND every mutation
 * (create / update / delete) that touches only our own databases. External/AI/
 * Canvas endpoints are out of scope (LLM/embedding/Canvas latency reflects a
 * provider, not our code — see docs/perf/baseline/*-measurement-spec.md and the
 * SKIP lists). NOT AI-chat latency, NOT load/concurrency (that's #918 —
 * concurrency=1 here).
 *
 * Data contract: mutations need disposable, tagged rows to create/update/delete.
 * `npm run db:seed:perf` (root) seeds all three DBs AND writes a per-app manifest
 * to `<repoRoot>/.perf-pool/{core,aitutor,qm}.json` listing the pooled ids. This
 * script reads those manifests. A run may DEPLETE the delete pools → **re-run
 * `npm run db:seed:perf` between perf runs.** A preflight check verifies the
 * manifests exist and are non-empty before measuring.
 *
 * Auth: all three apps validate sessions against Core. This mints ONE better-auth
 * cookie per role from Core (POST /api/auth/sign-in/email) + one for the pooled
 * "perf actor" user (for /me, /preferences, /bug-reports), and reuses them across
 * apps. AI-Tutor/QM requests forward the cookie to Core /api/sessions/validate,
 * which is IP rate-limited — a client-side governor paces those so the limiter
 * never fires (no server change).
 *
 * Usage:
 *   npm run db:seed:perf          # once (and again between runs to refill pools)
 *   CORE_URL=http://localhost:3000 AITUTOR_URL=http://localhost:4000 \
 *     QM_URL=http://localhost:8000 \
 *     npm run perf:endpoints -- --out=docs/perf/baseline --target=local-docker
 *
 * CLI flags (win over env): --out=<dir> (output dir), --target=<label>.
 *   Note the npm `--` that forwards args to the script.
 * Env: CORE_URL, AITUTOR_URL, QM_URL (set "" to skip an app), SEED_PASSWORD,
 *   PERF_WARMUP(3), PERF_SAMPLES(30), PERF_MUT_SAMPLES(15), PERF_POOL_DIR,
 *   PERF_VALIDATE_LIMIT(300), PERF_VALIDATE_WINDOW_MS(60000), TARGET_LABEL,
 *   PERF_SKIP_MUTATIONS(0).  (Output dir is --out only, no env.)
 *
 * Output: <out>/response-times.json + <out>/errors.log + <out>/errors.json.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// CLI flags. Supports `--out=dir`, `--out dir`, and `--target=label`.
// --out sets the output dir (no env equivalent); --target wins over TARGET_LABEL env.
// Invoke via npm with a forwarding `--`:  npm run perf:endpoints -- --out=docs/perf/baseline
function cliFlag(name) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return (argv[i + 1] ?? "").trim() || undefined;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3).trim() || undefined;
  }
  return undefined;
}

const CORE_URL = (process.env.CORE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AITUTOR_URL = (process.env.AITUTOR_URL ?? "http://localhost:4000").replace(/\/$/, "");
const QM_URL = (process.env.QM_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "EduAI2026!";
const WARMUP = Number(process.env.PERF_WARMUP ?? 3);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 30);
const RUN_MUTATIONS = (process.env.PERF_SKIP_MUTATIONS ?? "0") !== "1";
const MUT = Number(process.env.PERF_MUT_SAMPLES ?? 15);
const TARGET_LABEL = cliFlag("target") ?? process.env.TARGET_LABEL ?? "unspecified";
const OUT_DIR = (cliFlag("out") ?? `docs/perf/baseline`).replace(/\/$/, "");
const VALIDATE_LIMIT = Number(process.env.PERF_VALIDATE_LIMIT ?? 300);
const VALIDATE_WINDOW_MS = Number(process.env.PERF_VALIDATE_WINDOW_MS ?? 60_000);

const ROLE_USERS = {
  admin: "admin@eduai.local",
  instructor: "instructor.cs@eduai.local",
  ta: "ta.cs@eduai.local",
  student: "student1@eduai.local",
  unitadmin: "unitadmin.cosc@eduai.local",
};

// ---------------------------------------------------------------------------
// Manifests (written by db:seed:perf)
// ---------------------------------------------------------------------------
function poolDir() {
  if (process.env.PERF_POOL_DIR) return process.env.PERF_POOL_DIR;
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(d, "package.json");
    if (existsSync(pkg)) {
      try { if (JSON.parse(readFileSync(pkg, "utf8")).workspaces) return path.join(d, ".perf-pool"); } catch { /* */ }
    }
    d = path.dirname(d);
  }
  return path.join(process.cwd(), ".perf-pool");
}
function loadManifest(name) {
  const f = path.join(poolDir(), `${name}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Stats / fetch utils
// ---------------------------------------------------------------------------
const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const isOk = (s) => s >= 200 && s < 400;
function summarize(samples) {
  const ok = samples.filter((s) => isOk(s.status));
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  const bytes = ok.map((s) => s.bytes).sort((a, b) => a - b);
  const statuses = {};
  let errors = 0, errSample = null;
  for (const s of samples) {
    statuses[s.status] = (statuses[s.status] ?? 0) + 1;
    if (!isOk(s.status)) { errors++; if (!errSample) errSample = { status: s.status, message: s.errText ?? null, body: s.text ?? s.errText ?? null }; }
  }
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  return {
    count: samples.length, ok_count: ok.length, error_count: errors,
    latency_ms: { p50: round(pct(ms, 50)), p95: round(pct(ms, 95)), p99: round(pct(ms, 99)), mean: round(mean), min: round(ms[0] ?? null), max: round(ms.length ? ms[ms.length - 1] : null) },
    payload_bytes: { avg: bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : null, p95: pct(bytes, 95), max: bytes.length ? bytes[bytes.length - 1] : null },
    status_codes: statuses, error_rate: round(errors / (samples.length || 1)), error_sample: errSample,
  };
}

async function timedFetch(url, opts) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "manual" });
    const body = await res.arrayBuffer();
    const t1 = performance.now();
    const text = new TextDecoder().decode(body);
    const errText = res.status >= 400 ? text.replace(/\s+/g, " ").slice(0, 160) : null;
    return { ms: t1 - t0, status: res.status, bytes: body.byteLength, errText, text };
  } catch (err) {
    const t1 = performance.now();
    return { ms: t1 - t0, status: 0, bytes: 0, error: String(err?.message ?? err), errText: String(err?.message ?? err) };
  }
}

// Governor: any request that makes Core call /api/sessions/validate (ai-tutor +
// qm, and Core's own validate endpoint) passes through here to stay under the limit.
const _validateHits = [];
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function validateGate() {
  const margin = Math.max(5, Math.ceil(VALIDATE_LIMIT * 0.05));
  const cap = Math.max(1, VALIDATE_LIMIT - margin);
  for (;;) {
    const now = performance.now();
    while (_validateHits.length && now - _validateHits[0] >= VALIDATE_WINDOW_MS) _validateHits.shift();
    if (_validateHits.length < cap) break;
    await _sleep(Math.max(VALIDATE_WINDOW_MS - (now - _validateHits[0]) + 5, 10));
  }
  _validateHits.push(performance.now());
}
const paces = (app) => app === "ai-tutor" || app === "qm";
async function pacedFetch(app, url, opts, pace = false) {
  if (!paces(app) && !pace) return timedFetch(url, opts);
  await validateGate();
  let r = await timedFetch(url, opts);
  if (r.status === 429) {
    _validateHits.length = 0;
    await _sleep(VALIDATE_WINDOW_MS + 500);
    await validateGate();
    r = await timedFetch(url, opts);
  }
  return r;
}

const jsonHeaders = (cookie) => ({ Cookie: cookie ?? "", "Content-Type": "application/json" });
const dig = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const idFrom = (text, p) => { try { return dig(JSON.parse(text), p); } catch { return undefined; } };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function signIn(email, password) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(`${CORE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: CORE_URL },
        body: JSON.stringify({ email, password, rememberMe: true }),
        redirect: "manual",
      });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
      if (cookie && res.status < 400) return cookie;
      if (res.status !== 429 && res.status !== 403) return null;
    } catch { /* retry */ }
  }
  return null;
}
async function mintCookies(actor) {
  const cookies = {};
  for (const [role, email] of Object.entries(ROLE_USERS)) {
    cookies[role] = await signIn(email, SEED_PASSWORD);
    console.error(`  ${cookies[role] ? "✓" : "✗"} auth ${role} (${email})`);
    await sleep(400);
  }
  if (actor?.email) {
    cookies.actor = await signIn(actor.email, actor.password ?? SEED_PASSWORD);
    console.error(`  ${cookies.actor ? "✓" : "✗"} auth actor (${actor.email})`);
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// Runtime discovery for the few endpoints whose valid body is data-dependent
// (a known cron job name; an existing policy key to toggle and restore).
// ---------------------------------------------------------------------------
async function discover(cookies) {
  const d = { cronJob: null, policyKey: null, policyOrig: null };
  try {
    const r = await fetch(`${CORE_URL}/api/admin/cron-jobs`, { headers: { Cookie: cookies.admin ?? "" } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.jobs ?? j.data ?? [];
    if (list[0]) d.cronJob = list[0].jobName ?? list[0].name ?? null;
  } catch { /* */ }
  try {
    const r = await fetch(`${CORE_URL}/api/policies`, { headers: { Cookie: cookies.admin ?? "" } });
    const j = await r.json();
    const flags = j.policies ?? j.flags ?? j.data ?? j;
    if (flags && typeof flags === "object") {
      const key = Object.keys(flags).find((k) => typeof (flags[k]?.value ?? flags[k]) === "boolean");
      if (key) { d.policyKey = key; d.policyOrig = flags[key]?.value ?? flags[key]; }
    }
  } catch { /* */ }
  console.error(`  discovered: cronJob=${d.cronJob} policyKey=${d.policyKey}`);
  return d;
}

// ---------------------------------------------------------------------------
// READ targets — hammered SAMPLES× each. Built from the manifests.
// ---------------------------------------------------------------------------
function buildReads(cookies, m) {
  const t = [];
  const add = (app, method, path, role, url, pace = false) => t.push({ app, method, path, role, url, kind: "read", pace });
  const C = m.core, A = m.aitutor, Q = m.qm;

  // ---- Core ----
  if (CORE_URL) {
    add("core", "GET", "/api/health", "student", `${CORE_URL}/api/health`);
    add("core", "GET", "/api/disciplines", "student", `${CORE_URL}/api/disciplines`);
    add("core", "GET", "/api/courses", "instructor", `${CORE_URL}/api/courses`);
    add("core", "GET", "/api/ai-providers", "admin", `${CORE_URL}/api/ai-providers`);
    add("core", "GET", "/api/ai-models", "admin", `${CORE_URL}/api/ai-models`);
    add("core", "GET", "/api/users", "admin", `${CORE_URL}/api/users`);
    add("core", "GET", "/api/invitations", "admin", `${CORE_URL}/api/invitations`);
    add("core", "GET", "/api/policies", "admin", `${CORE_URL}/api/policies`);
    add("core", "GET", "/api/dashboard/stats", "admin", `${CORE_URL}/api/dashboard/stats`);
    add("core", "GET", "/api/admin/bug-reports", "admin", `${CORE_URL}/api/admin/bug-reports`);
    add("core", "GET", "/api/admin/cron-jobs", "admin", `${CORE_URL}/api/admin/cron-jobs`);
    add("core", "GET", "/api/chats", "student", `${CORE_URL}/api/chats`);
    add("core", "POST", "/api/sessions/validate", "student", `${CORE_URL}/api/sessions/validate`, true);
    if (C) {
      add("core", "GET", "/api/me", "actor", `${CORE_URL}/api/me`);
      add("core", "GET", "/api/preferences", "actor", `${CORE_URL}/api/preferences`);
      add("core", "GET", "/api/bug-reports?mine", "actor", `${CORE_URL}/api/bug-reports?mine=true`);
      add("core", "GET", "/api/courses/:id", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}`);
      add("core", "GET", "/api/courses/:id/materials", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/materials`);
      add("core", "GET", "/api/courses/:id/materials/:mid", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/materials/${C.updateMaterialId}`);
      add("core", "GET", "/api/courses/:id/embedding-settings", "instructor", `${CORE_URL}/api/courses/${C.updateCourseId}/embedding-settings`);
      add("core", "GET", "/api/courses/:id/topics", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/topics`);
      add("core", "GET", "/api/courses/:id/topics/:tid", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/topics/${C.readTopicId}`);
      add("core", "GET", "/api/courses/:id/chats", "admin", `${CORE_URL}/api/courses/${C.sharedCourseId}/chats`);
      add("core", "GET", "/api/units/:dept/chats", "admin", `${CORE_URL}/api/units/${C.department}/chats`);
      add("core", "GET", "/api/courses/:id/tas", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/tas`);
      add("core", "GET", "/api/courses/:id/enrollments", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/enrollments`);
      add("core", "GET", "/api/courses/:id/rag-settings", "instructor", `${CORE_URL}/api/courses/${C.sharedCourseId}/rag-settings`);
      add("core", "GET", "/api/questions?courseId", "instructor", `${CORE_URL}/api/questions?courseId=${C.sharedCourseId}`);
      add("core", "GET", "/api/questions/:id", "instructor", `${CORE_URL}/api/questions/${C.readQuestionId}`);
      add("core", "GET", "/api/chats/:id", "student", `${CORE_URL}/api/chats/${C.readChatId}`);
      add("core", "GET", "/api/chats/:id/messages", "student", `${CORE_URL}/api/chats/${C.readChatId}/messages`);
    }
  }

  // ---- AI-Tutor ----
  if (AITUTOR_URL) {
    add("ai-tutor", "GET", "/api/me", "student", `${AITUTOR_URL}/api/me`);
    add("ai-tutor", "GET", "/api/courses", "student", `${AITUTOR_URL}/api/courses`);
    add("ai-tutor", "GET", "/api/suggested-prompts", "student", `${AITUTOR_URL}/api/suggested-prompts`);
    add("ai-tutor", "GET", "/api/ai-models", "student", `${AITUTOR_URL}/api/ai-models`);
    add("ai-tutor", "GET", "/api/prompts", "instructor", `${AITUTOR_URL}/api/prompts`);
    add("ai-tutor", "GET", "/api/me/submissions", "student", `${AITUTOR_URL}/api/me/submissions`);
    add("ai-tutor", "GET", "/api/me/feedback", "student", `${AITUTOR_URL}/api/me/feedback`);
    add("ai-tutor", "GET", "/api/admin/courses", "admin", `${AITUTOR_URL}/api/admin/courses`);
    add("ai-tutor", "GET", "/api/admin/settings/eduai-api-key", "admin", `${AITUTOR_URL}/api/admin/settings/eduai-api-key`);
    add("ai-tutor", "GET", "/api/admin/settings/ai-model-policy", "admin", `${AITUTOR_URL}/api/admin/settings/ai-model-policy`);
    if (A) {
      const c = A.nativeCourseId;
      add("ai-tutor", "GET", "/api/courses/:id", "instructor", `${AITUTOR_URL}/api/courses/${c}`);
      add("ai-tutor", "GET", "/api/courses/:id/feedback", "instructor", `${AITUTOR_URL}/api/courses/${c}/feedback`);
      add("ai-tutor", "GET", "/api/courses/:id/submissions", "instructor", `${AITUTOR_URL}/api/courses/${c}/submissions`);
      add("ai-tutor", "GET", "/api/courses/:id/student-metrics", "instructor", `${AITUTOR_URL}/api/courses/${c}/student-metrics`);
      add("ai-tutor", "GET", "/api/courses/:id/analytics", "instructor", `${AITUTOR_URL}/api/courses/${c}/analytics`);
      add("ai-tutor", "GET", "/api/courses/:id/modules", "instructor", `${AITUTOR_URL}/api/courses/${c}/modules`);
      add("ai-tutor", "GET", "/api/courses/:id/topics", "instructor", `${AITUTOR_URL}/api/courses/${c}/topics`);
      add("ai-tutor", "GET", "/api/admin/courses/:id/enrollments", "admin", `${AITUTOR_URL}/api/admin/courses/${c}/enrollments`);
      add("ai-tutor", "GET", "/api/modules/:id", "instructor", `${AITUTOR_URL}/api/modules/${A.seededModuleId}`);
      add("ai-tutor", "GET", "/api/modules/:id/lessons", "instructor", `${AITUTOR_URL}/api/modules/${A.seededModuleId}/lessons`);
      add("ai-tutor", "GET", "/api/lessons/:id", "instructor", `${AITUTOR_URL}/api/lessons/${A.seededLessonId}`);
      add("ai-tutor", "GET", "/api/lessons/:id/activities", "instructor", `${AITUTOR_URL}/api/lessons/${A.seededLessonId}/activities`);
      add("ai-tutor", "GET", "/api/activities/:id/submissions", "instructor", `${AITUTOR_URL}/api/activities/${A.seededActivityId}/submissions`);
      add("ai-tutor", "GET", "/api/activities/:id/feedback", "instructor", `${AITUTOR_URL}/api/activities/${A.seededActivityId}/feedback`);
      add("ai-tutor", "GET", "/api/activities/:id/chat-sessions", "student", `${AITUTOR_URL}/api/activities/${A.seededActivityId}/chat-sessions`);
      add("ai-tutor", "GET", "/api/activities/:id/chat-sessions/:cid/messages", "student", `${AITUTOR_URL}/api/activities/${A.seededActivityId}/chat-sessions/${A.seededChatId}/messages`);
    }
  }

  // ---- Question Maker ----
  if (QM_URL) {
    add("qm", "GET", "/api/auth/me", "instructor", `${QM_URL}/api/auth/me`);
    add("qm", "GET", "/api/course", "instructor", `${QM_URL}/api/course`);
    add("qm", "GET", "/api/questions", "instructor", `${QM_URL}/api/questions`);
    add("qm", "GET", "/api/questions/stats", "instructor", `${QM_URL}/api/questions/stats`);
    add("qm", "GET", "/api/assessments", "instructor", `${QM_URL}/api/assessments`);
    if (Q) {
      const c = Q.courseId;
      add("qm", "GET", "/api/course/:id", "instructor", `${QM_URL}/api/course/${c}`);
      add("qm", "GET", "/api/course/:id/access", "instructor", `${QM_URL}/api/course/${c}/access`);
      add("qm", "GET", "/api/course/:id/topics", "instructor", `${QM_URL}/api/course/${c}/topics`);
      add("qm", "GET", "/api/course/:id/enrollments", "instructor", `${QM_URL}/api/course/${c}/enrollments`);
      add("qm", "GET", "/api/questions/export?courseId", "instructor", `${QM_URL}/api/questions/export?courseId=${c}&format=json`);
      add("qm", "GET", "/api/questions/:id", "instructor", `${QM_URL}/api/questions/${Q.anchorQuestionId}`);
      add("qm", "GET", "/api/questions/:id/variants", "instructor", `${QM_URL}/api/questions/${Q.anchorQuestionId}/variants`);
      add("qm", "GET", "/api/assessments/:id", "instructor", `${QM_URL}/api/assessments/${Q.anchorAssessmentId}`);
      add("qm", "GET", "/api/assessments/:id/questions", "instructor", `${QM_URL}/api/assessments/${Q.anchorAssessmentId}/questions`);
      add("qm", "GET", "/api/assessments/:id/sections", "instructor", `${QM_URL}/api/assessments/${Q.anchorAssessmentId}/sections`);
      add("qm", "GET", "/api/assessments/questions/:qid/check-in-assessments", "instructor", `${QM_URL}/api/assessments/questions/${Q.anchorQuestionId}/check-in-assessments`);
      add("qm", "GET", "/api/assessment-variant/assessments/:id/blueprint-snapshot", "instructor", `${QM_URL}/api/assessment-variant/assessments/${Q.anchorAssessmentId}/blueprint-snapshot`);
      add("qm", "GET", "/api/assessment-variant/assessments/:id/variant-readiness", "instructor", `${QM_URL}/api/assessment-variant/assessments/${Q.anchorAssessmentId}/variant-readiness`);
      add("qm", "GET", "/api/topics/sync-status/:id", "instructor", `${QM_URL}/api/topics/sync-status/${c}`);
    }
  }

  return t.filter((x) => x.url && !/\/(undefined|null)(\/|$|\?)/.test(x.url));
}

async function measureRead(tgt, cookies) {
  const opts = { method: tgt.method, headers: { Cookie: cookies[tgt.role] ?? "" } };
  const cold = await pacedFetch(tgt.app, tgt.url, opts, tgt.pace);
  for (let i = 0; i < WARMUP; i++) await pacedFetch(tgt.app, tgt.url, opts, tgt.pace);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(await pacedFetch(tgt.app, tgt.url, opts, tgt.pace));
  return { app: tgt.app, method: tgt.method, path: tgt.path, role: tgt.role, kind: "read", cold_start_ms: round(cold.ms), cold_status: cold.status, ...summarize(samples) };
}

// ---------------------------------------------------------------------------
// Mutation op factories. Each returns an async (cookies) => resultRow.
// n is capped by the available pool so a run never exceeds what the seed gave.
// ---------------------------------------------------------------------------
function mutRow(app, method, path, role, samples, note) {
  return { app, method, path, role, kind: "mutation", cold_start_ms: round(samples[0]?.ms ?? null), cold_status: samples[0]?.status ?? 0, ...summarize(samples), ...(note ? { note } : {}) };
}
const capN = (arr) => Math.max(0, Math.min(MUT, Array.isArray(arr) ? arr.length : MUT));

// POST create: body(i) → measure; capture id; optional best-effort cleanup (untimed).
function opCreate({ app, path, role, url, body, idPath, cleanupUrl }) {
  return async (cookies) => {
    const H = jsonHeaders(cookies[role]);
    const created = [], samples = [];
    for (let i = 0; i < MUT; i++) {
      const s = await pacedFetch(app, url, { method: "POST", headers: H, body: JSON.stringify(body(i)) });
      samples.push(s);
      if (idPath) { const id = idFrom(s.text, idPath); if (id != null) created.push(id); }
    }
    if (cleanupUrl && created.length) for (const id of created) await pacedFetch(app, cleanupUrl(id), { method: "DELETE", headers: { Cookie: cookies[role] ?? "" } });
    return mutRow(app, "POST", path, role, samples);
  };
}
// PUT/PATCH update: reuse one row, body(i) each iteration.
function opUpdate({ app, method, path, role, url, body }) {
  return async (cookies) => {
    const H = jsonHeaders(cookies[role]);
    const samples = [];
    for (let i = 0; i < MUT; i++) samples.push(await pacedFetch(app, url, { method, headers: H, body: JSON.stringify(body(i)) }));
    return mutRow(app, method, path, role, samples);
  };
}
// DELETE (or delete-by-body): consume up to n pooled victims.
function opDelete({ app, method = "DELETE", path, role, pool, urlFn, body }) {
  return async (cookies) => {
    const list = (pool ?? []).slice(0, capN(pool));
    const samples = [];
    for (const v of list) {
      const opts = { method, headers: body ? jsonHeaders(cookies[role]) : { Cookie: cookies[role] ?? "" } };
      if (body) opts.body = JSON.stringify(body(v));
      samples.push(await pacedFetch(app, urlFn(v), opts));
    }
    const note = list.length < MUT ? `pool=${list.length} (<${MUT}); re-seed to refill` : undefined;
    return list.length ? mutRow(app, method, path, role, samples, note) : errRow(app, method, path, role, "empty pool — run db:seed:perf");
  };
}
const errRow = (app, method, path, role, msg) => ({ app, method, path, role, kind: "mutation", cold_start_ms: null, cold_status: 0, count: 0, ok_count: 0, error_count: 1, latency_ms: { p50: null, p95: null, p99: null, mean: null, min: null, max: null }, payload_bytes: { avg: null, p95: null, max: null }, status_codes: {}, error_rate: 1, error_sample: { status: 0, message: msg }, note: "skipped" });

function buildMutations(m, disc) {
  const ops = [];
  const C = m.core, A = m.aitutor, Q = m.qm;
  const uniq = (p, i) => `${p}-${process.pid}-${i}`;

  // ===================== Core =====================
  if (CORE_URL && C) {
    const base = `${CORE_URL}`;
    // courses
    ops.push(opCreate({ app: "core", path: "POST /api/courses", role: "instructor", url: `${base}/api/courses`, idPath: "id", cleanupUrl: (id) => `${base}/api/courses/${id}`,
      // `term` is the canonical UBC code enum (`@eduai/ui/term` TERM_CODES) — W2 matches the Jan startDate.
      body: (i) => ({ name: "Perf C", code: uniq("PERF-NEW", i), section: "001", term: "W2", year: 2026, startDate: "2026-01-01", department: C.department, isPublished: false, aiInstructions: "" }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id", role: "instructor", url: `${base}/api/courses/${C.updateCourseId}`, body: (i) => ({ name: `Perf C v${i}` }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/courses/:id", role: "instructor", pool: C.deleteCoursePool, urlFn: (id) => `${base}/api/courses/${id}` }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/publish", role: "instructor", url: `${base}/api/courses/${C.updateCourseId}/publish`, body: () => ({}) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/unpublish", role: "instructor", url: `${base}/api/courses/${C.updateCourseId}/unpublish`, body: () => ({}) }));
    // materials (metadata)
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/materials/:mid", role: "instructor", url: `${base}/api/courses/${C.sharedCourseId}/materials/${C.updateMaterialId}`, body: (i) => ({ title: `Renamed ${i}` }) }));
    ops.push(opUpdate({ app: "core", method: "PUT", path: "PUT /api/courses/:id/materials/:mid", role: "instructor", url: `${base}/api/courses/${C.sharedCourseId}/materials/${C.updateMaterialId}`, body: (i) => ({ title: `Renamed put ${i}` }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/courses/:id/materials/:mid", role: "instructor", pool: C.deleteMaterialPool, urlFn: (id) => `${base}/api/courses/${C.sharedCourseId}/materials/${id}` }));
    // embedding + rag settings
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/embedding-settings", role: "instructor", url: `${base}/api/courses/${C.updateCourseId}/embedding-settings`, body: () => ({ embeddingProvider: "local", embeddingModel: "mxbai-embed-large" }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/rag-settings", role: "instructor", url: `${base}/api/courses/${C.updateCourseId}/rag-settings`, body: () => ({ ragTopK: 5, ragSimilarityThreshold: 0.5 }) }));
    // topics
    ops.push(opCreate({ app: "core", path: "POST /api/courses/:id/topics", role: "instructor", url: `${base}/api/courses/${C.sharedCourseId}/topics`, idPath: "id", cleanupUrl: (id) => `${base}/api/courses/${C.sharedCourseId}/topics/${id}`, body: (i) => ({ name: `Perf Topic ${uniq("t", i)}` }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/topics/:tid", role: "instructor", url: `${base}/api/courses/${C.sharedCourseId}/topics/${C.updateTopicId}`, body: (i) => ({ name: `Renamed ${uniq("t", i)}` }) }));
    // Canonical delete-topic contract carries {topicId} in the body (see the route's
    // `await request.json()`); a bodyless DELETE throws "Unexpected end of JSON input".
    ops.push(opDelete({ app: "core", path: "DELETE /api/courses/:id/topics/:tid", role: "instructor", pool: C.deleteTopicPool, urlFn: (id) => `${base}/api/courses/${C.sharedCourseId}/topics/${id}`, body: (id) => ({ topicId: id }) }));
    // TAs
    ops.push(opDelete({ app: "core", method: "POST", path: "POST /api/courses/:id/tas", role: "instructor", pool: C.taAddUserPool, urlFn: () => `${base}/api/courses/${C.sharedCourseId}/tas`, body: (uid) => ({ userId: uid }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/courses/:id/tas", role: "instructor", pool: C.taRemoveUserIds, urlFn: () => `${base}/api/courses/${C.sharedCourseId}/tas`, body: (uid) => ({ userId: uid }) }));
    // enrollments
    ops.push(opDelete({ app: "core", method: "POST", path: "POST /api/courses/:id/enrollments", role: "instructor", pool: C.enrolleeUserPool, urlFn: () => `${base}/api/courses/${C.sharedCourseId}/enrollments`, body: (uid) => ({ userId: uid, role: "STUDENT" }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/courses/:id/enrollments/:eid", role: "instructor", url: `${base}/api/courses/${C.sharedCourseId}/enrollments/${C.updateEnrollmentId}`, body: () => ({ role: "TA" }) }));
    // questions
    ops.push(opCreate({ app: "core", path: "POST /api/questions", role: "instructor", url: `${base}/api/questions`, idPath: "id", body: (i) => ({ courseId: C.sharedCourseId, topicId: C.readTopicId, content: `Perf Q ${i}?`, type: "MCQ", choices: [{ letter: "A", text: "x" }, { letter: "B", text: "y" }], answer: "A" }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/questions/:id", role: "instructor", url: `${base}/api/questions/${C.questionUpdateId}`, body: (i) => ({ testable: i % 2 === 0 }) }));
    // ai providers / models
    ops.push(opCreate({ app: "core", path: "POST /api/ai-providers", role: "admin", url: `${base}/api/ai-providers`, idPath: "id", cleanupUrl: (id) => `${base}/api/ai-providers/${id}`, body: (i) => ({ name: uniq("perf-prov", i), displayName: "Perf", description: "perf", requiresApiKey: false, isActive: true }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/ai-providers/:id", role: "admin", url: `${base}/api/ai-providers/${C.updateProviderId}`, body: (i) => ({ displayName: `Perf v${i}` }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/ai-providers/:id", role: "admin", pool: C.deleteProviderPool, urlFn: (id) => `${base}/api/ai-providers/${id}` }));
    ops.push(opCreate({ app: "core", path: "POST /api/ai-models", role: "admin", url: `${base}/api/ai-models`, idPath: "id", cleanupUrl: (id) => `${base}/api/ai-models/${id}`, body: (i) => ({ modelId: uniq("perf-model", i), name: "Perf Model", description: "perf", type: "CHAT", providerId: C.updateProviderId, isActive: true }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/ai-models/:id", role: "admin", url: `${base}/api/ai-models/${C.updateModelId}`, body: (i) => ({ name: `Perf Model v${i}` }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/ai-models/:id", role: "admin", pool: C.deleteModelPool, urlFn: (id) => `${base}/api/ai-models/${id}` }));
    // me / preferences (actor)
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/me", role: "actor", url: `${base}/api/me`, body: (i) => ({ name: `Perf Name ${i}` }) }));
    ops.push(opUpdate({ app: "core", method: "POST", path: "POST /api/preferences", role: "actor", url: `${base}/api/preferences`, body: (i) => ({ theme: i % 2 ? "dark" : "light", density: "comfortable", motionReduced: false }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/preferences", role: "actor", url: `${base}/api/preferences`, body: (i) => ({ theme: i % 2 ? "light" : "dark" }) }));
    // users (admin)
    ops.push(opCreate({ app: "core", path: "POST /api/users", role: "admin", url: `${base}/api/users`, idPath: "id", cleanupUrl: (id) => `${base}/api/users/${id}`, body: (i) => ({ name: "Perf User", email: `perf+${uniq("u", i)}@perf.local`, role: "STUDENT" }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/users/:id", role: "admin", url: `${base}/api/users/${C.updateUserId}`, body: (i) => ({ name: `Perf User v${i}` }) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/users/:id", role: "admin", pool: C.deleteUserPool, urlFn: (id) => `${base}/api/users/${id}` }));
    // invitations (admin)
    // Email must be a UBC address (lib/auth/ubc-email.ts) or the invite 400s.
    ops.push(opCreate({ app: "core", path: "POST /api/invitations", role: "admin", url: `${base}/api/invitations`, idPath: "invitation.id", cleanupUrl: (id) => `${base}/api/invitations/${id}`, body: (i) => ({ email: `invite-${uniq("i", i)}@ubc.ca`, role: "INSTRUCTOR" }) }));
    ops.push(opUpdate({ app: "core", method: "POST", path: "POST /api/invitations/:id (resend)", role: "admin", url: `${base}/api/invitations/${C.resendInvitationId}`, body: () => ({}) }));
    ops.push(opDelete({ app: "core", path: "DELETE /api/invitations/:id", role: "admin", pool: C.deleteInvitationPool, urlFn: (id) => `${base}/api/invitations/${id}` }));
    // bug reports
    ops.push(opUpdate({ app: "core", method: "POST", path: "POST /api/bug-reports", role: "actor", url: `${base}/api/bug-reports`, body: (i) => ({ description: `perf bug ${i}` }) }));
    ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/admin/bug-reports/:id", role: "admin", url: `${base}/api/admin/bug-reports/${C.bugReportId}`, body: (i) => ({ status: i % 2 ? "IN_PROGRESS" : "UNHANDLED" }) }));
    // assistive events (create, no cleanup)
    // eventType must be one of ASSISTIVE_CLIENT_EVENT_TYPES (assistive-events.ts) or 422.
    ops.push(opUpdate({ app: "core", method: "POST", path: "POST /api/assistive-events", role: "actor", url: `${base}/api/assistive-events`, body: () => ({ eventType: "mode_toggled" }) }));
    // cron jobs (update-schedule only) — needs a known job name
    if (disc.cronJob) ops.push(opUpdate({ app: "core", method: "POST", path: "POST /api/admin/cron-jobs", role: "admin", url: `${base}/api/admin/cron-jobs`, body: () => ({ intent: "update-schedule", jobName: disc.cronJob, schedule: "0 3 * * *", scheduleLabel: "Daily 3am" }) }));
    // policies — toggle a discovered flag, restored after the run
    if (disc.policyKey) {
      ops.push(opUpdate({ app: "core", method: "PATCH", path: "PATCH /api/policies", role: "admin", url: `${base}/api/policies`, body: () => ({ key: disc.policyKey, value: true }) }));
      ops.push(opUpdate({ app: "core", method: "PUT", path: "PUT /api/policies", role: "admin", url: `${base}/api/policies`, body: () => ({ key: disc.policyKey, value: true }) }));
    }
  }

  // ===================== AI-Tutor =====================
  if (AITUTOR_URL && A) {
    const base = AITUTOR_URL;
    const nc = A.nativeCourseId;
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/courses/:id", role: "instructor", url: `${base}/api/courses/${nc}`, body: (i) => ({ title: `PERF upd ${i}` }) }));
    // NOTE: course publish/unpublish are pushed AFTER the module/lesson publish ops
    // below — module/lesson publish reject when the parent course is unpublished, and
    // ops run in array order, so unpublishing the native course here would 400 them.
    ops.push(opCreate({ app: "ai-tutor", path: "POST /api/courses/:id/modules", role: "instructor", url: `${base}/api/courses/${nc}/modules`, idPath: "id", cleanupUrl: (id) => `${base}/api/modules/${id}`, body: (i) => ({ title: `PERF mod ${i}`, position: 0 }) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/modules/:id/publish", role: "instructor", url: `${base}/api/modules/${A.poolModulesReuse[0]}/publish`, body: () => ({}) }));
    ops.push(opDelete({ app: "ai-tutor", path: "DELETE /api/modules/:id", role: "instructor", pool: A.poolModulesDrop, urlFn: (id) => `${base}/api/modules/${id}` }));
    ops.push(opCreate({ app: "ai-tutor", path: "POST /api/modules/:id/lessons", role: "instructor", url: `${base}/api/modules/${A.poolModulesReuse[1]}/lessons`, idPath: "id", cleanupUrl: (id) => `${base}/api/lessons/${id}`, body: (i) => ({ title: `PERF les ${i}`, position: 0 }) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/lessons/:id/publish", role: "instructor", url: `${base}/api/lessons/${A.poolLessonsReuse[0]}/publish`, body: () => ({}) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/lessons/:id/unpublish", role: "instructor", url: `${base}/api/lessons/${A.poolLessonsReuse[0]}/unpublish`, body: () => ({}) }));
    // Module unpublish runs AFTER the lesson publish/unpublish above: the reuse lessons
    // live under this module, lesson-publish requires its parent module published, and
    // module-unpublish cascades to its lessons — so it must go last of the module ops.
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/modules/:id/unpublish", role: "instructor", url: `${base}/api/modules/${A.poolModulesReuse[0]}/unpublish`, body: () => ({}) }));
    // Course publish/unpublish run LAST: unpublishing the native course would 400 the
    // module/lesson publish ops that target it.
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/courses/:id/publish", role: "instructor", url: `${base}/api/courses/${nc}/publish`, body: () => ({}) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/courses/:id/unpublish", role: "instructor", url: `${base}/api/courses/${nc}/unpublish`, body: () => ({}) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/lessons/:id", role: "instructor", url: `${base}/api/lessons/${A.poolLessonsReuse[1]}`, body: (i) => ({ contentMd: `PERF ${i}` }) }));
    ops.push(opDelete({ app: "ai-tutor", path: "DELETE /api/lessons/:id", role: "instructor", pool: A.poolLessonsDrop, urlFn: (id) => `${base}/api/lessons/${id}` }));
    ops.push(opCreate({ app: "ai-tutor", path: "POST /api/lessons/:id/activities", role: "instructor", url: `${base}/api/lessons/${A.poolLessonsReuse[0]}/activities`, idPath: "id", cleanupUrl: (id) => `${base}/api/activities/${id}`, body: () => ({ question: "2+2?", mainTopicId: A.nativeTopicId, type: "MCQ", options: ["3", "4"], answer: 1, hints: [], enableTeachMode: true, enableGuideMode: true }) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/activities/:id", role: "instructor", url: `${base}/api/activities/${A.poolActivitiesReuse[0]}`, body: (i) => ({ title: `PERF ${i}` }) }));
    ops.push(opDelete({ app: "ai-tutor", path: "DELETE /api/activities/:id", role: "instructor", pool: A.poolActivitiesDrop, urlFn: (id) => `${base}/api/activities/${id}` }));
    ops.push(opCreate({ app: "ai-tutor", path: "POST /api/courses/:id/topics", role: "instructor", url: `${base}/api/courses/${nc}/topics`, idPath: "id", body: (i) => ({ name: `PERF topic ${uniq("t", i)}` }) }));
    ops.push(opCreate({ app: "ai-tutor", path: "POST /api/prompts", role: "instructor", url: `${base}/api/prompts`, idPath: "id", body: (i) => ({ name: `PERF prompt ${uniq("p", i)}`, systemPrompt: "You are a helpful tutor.", temperature: 0.5, topP: 1 }) }));
    ops.push(opDelete({ app: "ai-tutor", method: "POST", path: "POST /api/admin/courses/:id/enrollments", role: "admin", pool: A.enrollDropUserIds.map((_, i) => `perf_user_new_${process.pid}_${i}`), urlFn: () => `${base}/api/admin/courses/${nc}/enrollments`, body: (uid) => ({ userId: uid, role: "STUDENT" }) }));
    ops.push(opDelete({ app: "ai-tutor", path: "DELETE /api/admin/courses/:id/enrollments/:uid", role: "admin", pool: A.enrollDropUserIds, urlFn: (uid) => `${base}/api/admin/courses/${nc}/enrollments/${uid}` }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PATCH", path: "PATCH /api/admin/courses/:id/enrollments/:uid/role", role: "admin", url: `${base}/api/admin/courses/${nc}/enrollments/${A.enrollRoleUserIds[0]}/role`, body: (i) => ({ role: i % 2 ? "TA" : "STUDENT" }) }));
    ops.push(opUpdate({ app: "ai-tutor", method: "PUT", path: "PUT /api/admin/settings/eduai-api-key", role: "admin", url: `${base}/api/admin/settings/eduai-api-key`, body: () => ({ apiKey: "perf-test-key" }) }));
  }

  // ===================== Question Maker =====================
  if (QM_URL && Q) {
    const base = QM_URL;
    const c = Q.courseId, tid = Q.primaryTopicId;
    ops.push(opCreate({ app: "qm", path: "POST /api/questions", role: "instructor", url: `${base}/api/questions`, idPath: "data.id", cleanupUrl: (id) => `${base}/api/questions/${id}`, body: () => ({ courseId: c, primaryTopicId: tid, type: "MCQ", description: "perf q" }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/questions/:id", role: "instructor", url: `${base}/api/questions/${Q.questionUpdateId}`, body: (i) => ({ description: `perf upd ${i}` }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/questions/:id", role: "instructor", pool: Q.questionDeletePool, urlFn: (id) => `${base}/api/questions/${id}` }));
    ops.push(opCreate({ app: "qm", path: "POST /api/questions/approve", role: "instructor", url: `${base}/api/questions/approve`, body: () => ({ courseId: c, questions: [{ description: "perf approved", primaryTopicId: tid, type: "MCQ" }] }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/questions/:id/order", role: "instructor", url: `${base}/api/questions/${Q.anchorQuestionId}/order`, body: () => ({ assessmentId: Q.anchorAssessmentId, orderNumber: 1 }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/questions/:id/order/:aid", role: "instructor", pool: Q.questionOrderPool, urlFn: (p) => `${base}/api/questions/${p.questionId}/order/${p.assessmentId}` }));
    ops.push(opCreate({ app: "qm", path: "POST /api/questions/:id/variants", role: "instructor", url: `${base}/api/questions/${Q.anchorQuestionId}/variants`, idPath: "data.id", cleanupUrl: (id) => `${base}/api/questions/variants/${id}`, body: (i) => ({ questionText: `perf variant ${i}`, difficulty: "medium", reasoningLevel: "factual", isDraft: true }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/questions/variants/:id", role: "instructor", url: `${base}/api/questions/variants/${Q.variantUpdateId}`, body: (i) => ({ questionText: `perf upd variant ${i}` }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/questions/variants/:id", role: "instructor", pool: Q.variantDeletePool, urlFn: (id) => `${base}/api/questions/variants/${id}` }));
    // course
    ops.push(opCreate({ app: "qm", path: "POST /api/course", role: "instructor", url: `${base}/api/course`, idPath: "data.id", cleanupUrl: (id) => `${base}/api/course/${id}`, body: (i) => ({ name: `__PERF__ new ${uniq("c", i)}`, courseCode: "PERFN" }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/course/:id", role: "instructor", url: `${base}/api/course/${Q.courseUpdateId}`, body: (i) => ({ name: `__PERF__ upd ${i}` }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/course/:id", role: "instructor", pool: Q.courseDeletePool, urlFn: (id) => `${base}/api/course/${id}` }));
    ops.push(opCreate({ app: "qm", path: "POST /api/course/:id/topics", role: "instructor", url: `${base}/api/course/${c}/topics`, idPath: "data.id", body: (i) => ({ name: `__PERF__ topic ${uniq("t", i)}` }) }));
    // assessments
    ops.push(opCreate({ app: "qm", path: "POST /api/assessments", role: "instructor", url: `${base}/api/assessments`, idPath: "data.id", cleanupUrl: (id) => `${base}/api/assessments/${id}`, body: () => ({ type: "Quiz", name: "__PERF__ a", semester: "Fall 2026", courseId: c }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/assessments/:id", role: "instructor", url: `${base}/api/assessments/${Q.assessmentUpdateId}`, body: (i) => ({ name: `__PERF__ upd a ${i}` }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/assessments/:id", role: "instructor", pool: Q.assessmentDeletePool, urlFn: (id) => `${base}/api/assessments/${id}` }));
    ops.push(opUpdate({ app: "qm", method: "POST", path: "POST /api/assessments/:id/questions", role: "instructor", url: `${base}/api/assessments/${Q.anchorAssessmentId}/questions`, body: () => ({ questionId: Q.anchorQuestionId, orderNumber: 1 }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/assessments/:id/questions/:qid", role: "instructor", pool: Q.questionOrderPool, urlFn: (p) => `${base}/api/assessments/${p.assessmentId}/questions/${p.questionId}` }));
    // sections
    ops.push(opCreate({ app: "qm", path: "POST /api/assessments/:id/sections", role: "instructor", url: `${base}/api/assessments/${Q.anchorAssessmentId}/sections`, idPath: "data.id", cleanupUrl: (id) => `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${id}`, body: (i) => ({ name: `__PERF__ sec ${i}` }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/assessments/:aid/sections/:sid", role: "instructor", url: `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${Q.sectionUpdateId}`, body: (i) => ({ name: `__PERF__ upd sec ${i}` }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/assessments/:aid/sections/:sid", role: "instructor", pool: Q.sectionDeletePool, urlFn: (id) => `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${id}` }));
    // section variants
    // (section_id, variant_id) is unique — reusing one variantId 409s after the
    // first insert, so consume a pool of distinct fresh variants (one per sample).
    ops.push(opDelete({ app: "qm", method: "POST", path: "POST /api/assessments/:aid/sections/:sid/variants", role: "instructor", pool: Q.sectionVariantAddPool, urlFn: () => `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${Q.anchorSectionId}/variants`, body: (vid) => ({ variantId: vid, displayOrder: 1 }) }));
    ops.push(opUpdate({ app: "qm", method: "PUT", path: "PUT /api/assessments/:aid/sections/:sid/variants/:vid/order", role: "instructor", url: `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${Q.sectionVariantUpdate.sectionId}/variants/${Q.sectionVariantUpdate.variantId}/order`, body: (i) => ({ displayOrder: i + 1 }) }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/assessments/:aid/sections/:sid/variants/:vid", role: "instructor", pool: Q.sectionVariantDeletePool, urlFn: (p) => `${base}/api/assessments/${Q.anchorAssessmentId}/sections/${p.sectionId}/variants/${p.variantId}` }));
    ops.push(opDelete({ app: "qm", path: "DELETE /api/assessments/questions/:qid/remove-from-all-sections", role: "instructor", pool: Q.questionWithSectionLinkPool, urlFn: (qid) => `${base}/api/assessments/questions/${qid}/remove-from-all-sections` }));
    // assessment-variant role (JSONB merge)
    ops.push(opUpdate({ app: "qm", method: "PATCH", path: "PATCH /api/assessment-variant/assessments/:id/role", role: "instructor", url: `${base}/api/assessment-variant/assessments/${Q.anchorAssessmentId}/role`, body: (i) => ({ studyRole: i % 2 ? "reference_baseline" : "generated_variant" }) }));
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Preflight — manifests must exist + be non-empty, else tell the user to seed.
// ---------------------------------------------------------------------------
function preflight(m) {
  const problems = [];
  if (CORE_URL && !m.core) problems.push("core");
  if (AITUTOR_URL && !m.aitutor) problems.push("aitutor");
  if (QM_URL && !m.qm) problems.push("qm");
  if (problems.length) {
    console.error(`\nFATAL preflight: missing pool manifest(s): ${problems.join(", ")} in ${poolDir()}`);
    console.error("  Run `npm run db:seed:perf` (seeds all three DBs + writes the manifests), then retry.");
    return false;
  }
  // Warn (not fatal) on depleted delete pools.
  const low = [];
  const chk = (obj, keys, app) => obj && keys.forEach((k) => { if (Array.isArray(obj[k]) && obj[k].length < MUT) low.push(`${app}.${k}=${obj[k].length}`); });
  chk(m.core, ["deleteCoursePool", "deleteMaterialPool", "deleteTopicPool", "deleteProviderPool", "deleteModelPool", "deleteUserPool", "deleteInvitationPool", "taAddUserPool", "taRemoveUserIds", "enrolleeUserPool"], "core");
  chk(m.aitutor, ["poolModulesDrop", "poolLessonsDrop", "poolActivitiesDrop", "enrollDropUserIds"], "aitutor");
  chk(m.qm, ["questionDeletePool", "variantDeletePool", "assessmentDeletePool", "sectionDeletePool", "courseDeletePool"], "qm");
  if (low.length) console.error(`  ⚠ pools below PERF_MUT_SAMPLES=${MUT} (deletes measure fewer samples): ${low.join(" ")}\n    re-run db:seed:perf to refill.`);
  return true;
}

// ---------------------------------------------------------------------------
function fingerprint() {
  const g = (c) => { try { return execSync(c).toString().trim(); } catch { return "unknown"; } };
  return {
    captured_at: new Date().toISOString(), target_label: TARGET_LABEL,
    targets: { CORE_URL, AITUTOR_URL: AITUTOR_URL || null, QM_URL: QM_URL || null },
    git_sha: g("git rev-parse --short HEAD"), git_branch: g("git branch --show-current"),
    node: process.version, platform: `${process.platform}-${process.arch}`,
    warmup: WARMUP, samples: SAMPLES, mut_samples: MUT, concurrency: 1, include_mutations: RUN_MUTATIONS,
    validate_governor: { limit: VALIDATE_LIMIT, window_ms: VALIDATE_WINDOW_MS, applies_to: ["ai-tutor", "qm", "core:sessions/validate"] },
    seed_note: "Run `npm run db:seed:perf` (all three DBs + pool manifests) before each run; deletes consume the pool.",
  };
}

// ---------------------------------------------------------------------------
async function main() {
  console.error(`perf-baseline — target=${TARGET_LABEL}`);
  console.error(`  CORE=${CORE_URL} AITUTOR=${AITUTOR_URL || "(skip)"} QM=${QM_URL || "(skip)"}`);
  console.error(`  warmup=${WARMUP} samples=${SAMPLES} mut=${MUT} concurrency=1  out=${OUT_DIR}\n`);

  const m = { core: loadManifest("core"), aitutor: loadManifest("aitutor"), qm: loadManifest("qm") };
  if (!preflight(m)) process.exit(2);

  console.error("Minting sessions…");
  const cookies = await mintCookies(m.core?.actor);
  if (!Object.values(cookies).some(Boolean)) {
    console.error("\nFATAL: no sessions minted. Is Core running + seeded at CORE_URL? Aborting.");
    process.exit(1);
  }

  console.error("\nDiscovering data-dependent bodies (cron/policy)…");
  const disc = await discover(cookies);

  const reads = buildReads(cookies, m);
  console.error(`\nMeasuring ${reads.length} read endpoints (concurrency=1)…`);
  const results = [];
  for (const tgt of reads) {
    const r = await measureRead(tgt, cookies);
    results.push(r);
    logRow(r);
  }

  if (RUN_MUTATIONS) {
    const ops = buildMutations(m, disc);
    console.error(`\nMeasuring ${ops.length} mutation endpoints…`);
    for (const op of ops) {
      let r;
      try { r = await op(cookies); } catch (e) { r = { app: "?", method: "?", path: "op-threw", role: "?", kind: "mutation", ...summarize([{ ms: 0, status: 0, errText: String(e?.message ?? e) }]) }; }
      results.push(r);
      logRow(r);
    }
    // Restore the toggled policy flag to its original value.
    if (disc.policyKey && cookies.admin) {
      try { await fetch(`${CORE_URL}/api/policies`, { method: "PATCH", headers: jsonHeaders(cookies.admin), body: JSON.stringify({ key: disc.policyKey, value: disc.policyOrig }) }); } catch { /* */ }
    }
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const payload = { env: fingerprint(), pool_manifests: { core: !!m.core, aitutor: !!m.aitutor, qm: !!m.qm }, results };
  const jsonPath = `${OUT_DIR}/response-times.json`;
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.error(`\n✓ wrote ${jsonPath} (${results.length} endpoints)`);
  writeErrorLog(results, OUT_DIR);

  const measured = results.filter((r) => r.ok_count > 0);
  const errored = results.filter((r) => r.ok_count === 0);
  console.error(`\n${measured.length} measured, ${errored.length} errored on every sample.`);
  const slow = [...measured].sort((a, b) => (b.latency_ms.p95 ?? 0) - (a.latency_ms.p95 ?? 0)).slice(0, 10);
  console.error("Slowest 10 by p95:");
  for (const r of slow) console.error(`  ${r.latency_ms.p95}ms  ${r.app} ${r.method} ${r.path}`);
  if (errored.length) {
    console.error(`\n⚠ errored endpoints (see error_sample in JSON):`);
    for (const r of errored) console.error(`  ✗ ${r.app} ${r.method} ${r.path} → ${r.error_sample?.status} ${r.error_sample?.message ?? ""}`);
  }
}

// Write every endpoint that failed on ≥1 sample to <OUT_DIR>/errors.log with the
// FULL (untruncated) server response body so failures can be diagnosed offline.
// error_sample.body holds the complete response text; the console only shows 160 chars.
function writeErrorLog(results, dir) {
  const errored = results.filter((r) => (r.error_count ?? 0) > 0 || r.ok_count === 0);
  const logPath = `${dir}/errors.log`;
  const jsonPath = `${dir}/errors.json`;
  if (!errored.length) {
    writeFileSync(logPath, `no errored endpoints — clean run (${results.length} measured)\n`);
    writeFileSync(jsonPath, JSON.stringify({ env: fingerprint(), errors: [] }, null, 2));
    console.error(`✓ wrote ${logPath} (no errors)`);
    return;
  }
  const lines = [`=== errored endpoints (${errored.length} of ${results.length}) ===`, ""];
  for (const r of errored) {
    const es = r.error_sample ?? {};
    lines.push(`[${r.app}] ${r.method} ${r.path}  (role=${r.role}, kind=${r.kind})`);
    lines.push(`  samples=${r.count ?? 0} errors=${r.error_count ?? 0} status_codes=${JSON.stringify(r.status_codes ?? {})}${r.note ? ` note=${r.note}` : ""}`);
    lines.push(`  first_error_status: ${es.status ?? "?"}`);
    lines.push(`  body:`);
    const body = (es.body ?? es.message ?? "(no body captured)").toString();
    for (const bl of body.split("\n")) lines.push(`    ${bl}`);
    lines.push("");
  }
  writeFileSync(logPath, lines.join("\n"));
  writeFileSync(jsonPath, JSON.stringify({ env: fingerprint(), errors: errored.map((r) => ({ app: r.app, method: r.method, path: r.path, role: r.role, kind: r.kind, count: r.count, error_count: r.error_count, status_codes: r.status_codes, error_sample: r.error_sample, note: r.note })) }, null, 2));
  console.error(`✓ wrote ${logPath} + ${jsonPath} (${errored.length} errored endpoints)`);
}

function logRow(r) {
  const l = r.latency_ms ?? {};
  if (!r.ok_count) console.error(`  ${String(r.app).padEnd(8)} ${String(r.method).padEnd(6)} ${String(r.path).padEnd(46)} ⚠ ${r.error_sample?.status ?? "?"} ${r.error_sample?.message ?? ""}`.slice(0, 160));
  else console.error(`  ${String(r.app).padEnd(8)} ${String(r.method).padEnd(6)} ${String(r.path).padEnd(46)} p50=${String(l.p50).padStart(6)} p95=${String(l.p95).padStart(6)}ms ${r.payload_bytes?.avg ?? 0}B [${Object.keys(r.status_codes).join(",")}]${r.error_count ? ` ⚠${r.error_count}` : ""}${r.note ? " " + r.note : ""}`);
}

main().catch((err) => { console.error("perf-baseline failed:", err); process.exit(1); });
