#!/usr/bin/env node
/**
 * PREREG_v3.md Phase 3 step 1: generate small-tier and large-tier answers
 * for all v3 prompts, via the real /api/chat HTTP path (course-scoped RAG,
 * same code path as production traffic) rather than reimplementing generation.
 *
 * Usage: node scripts/run-v3-generation.mjs <prompts.v3.jsonl> <seed-manifest.json> <out.jsonl>
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from this script's own directory (not cwd), so CMPS01_INTERNAL_KEY
// etc. don't need to be passed inline on the command line.
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // No .env file — fall back to whatever's already in the environment.
}

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const ORIGIN = process.env.ORIGIN ?? "https://dev.eduai.ok.ubc.ca";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@eduai.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "EduAI2026!";

// Dense ladder tiers, in ascending size order. Model + GPU placement per
// infra/cmps01, infra/cmps02 (one model per GPU):
//   cmps01 GPU0 = 2B, cmps01 GPU1 = 9B, cmps02 GPU0 = 4B, cmps02 GPU1 = 27B.
const TIER_MODELS = {
  "2b": "vllm:qwen3.5-2b-instruct",
  "4b": "vllm:qwen3.5-4b-instruct",
  "9b": "vllm:qwen3.5-9b-instruct",
  "27b": "vllm:qwen3.5-27b-instruct",
};

// Scoping gpuIndex avoids summing the sibling model's power draw on the other GPU
// (the exact bug fixed in tools/energy-meter tonight).
const ENERGY_CONFIG = {
  "2b": { sidecarUrl: "http://cmps01.ok.ubc.ca:8001/energy", gpuIndex: 0 },
  "9b": { sidecarUrl: "http://cmps01.ok.ubc.ca:8001/energy", gpuIndex: 1 },
  "4b": { sidecarUrl: "http://cmps02.ok.ubc.ca:8001/energy", gpuIndex: 0 },
  "27b": { sidecarUrl: "http://cmps02.ok.ubc.ca:8001/energy", gpuIndex: 1 },
};
const CMPS01_INTERNAL_KEY = process.env.CMPS01_INTERNAL_KEY ?? "";
// Comma-separated subset of TIER_MODELS keys to run, e.g. "4b,9b". Defaults to all four.
const TIERS_TO_RUN = (process.env.TIERS ?? "2b,4b,9b,27b").split(",").map((s) => s.trim());

async function measureStart(tier, tag) {
  const cfg = ENERGY_CONFIG[tier];
  try {
    const res = await fetch(`${cfg.sidecarUrl}/measure-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EduAI-Internal-Key": CMPS01_INTERNAL_KEY },
      body: JSON.stringify({ tag, gpuIndex: cfg.gpuIndex }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`  energy measure-start failed (${tier}): HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`  energy measure-start error (${tier}): ${e}`);
    return false;
  }
}

async function measureStop(tier, tag) {
  const cfg = ENERGY_CONFIG[tier];
  try {
    const res = await fetch(`${cfg.sidecarUrl}/measure-stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EduAI-Internal-Key": CMPS01_INTERNAL_KEY },
      body: JSON.stringify({ tag }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`  energy measure-stop failed (${tier}): HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`  energy measure-stop error (${tier}): ${e}`);
    return null;
  }
}

const themeToSlug = {
  intro_programming: "intro-programming",
  machine_architecture: "machine-architecture",
  software_engineering: "software-engineering",
  operating_systems: "operating-systems",
  hci: "hci",
};

function parseCookies(setCookieHeaders) {
  const jar = new Map();
  for (const header of setCookieHeaders) {
    const part = header.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return jar;
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function signIn(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    redirect: "manual",
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  const cookies = parseCookies(res.headers.getSetCookie?.() ?? []);
  if (res.status !== 200 || cookies.size === 0) {
    throw new Error(`sign-in failed: status=${res.status}`);
  }
  return cookies;
}

async function chatOnce(cookies, { model, courseId, prompt }) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(cookies), Origin: ORIGIN },
    body: JSON.stringify({
      chatMode: "course",
      model,
      courseId,
      ephemeral: true,
      apiKeys: {},
      streaming: false,
      messages: [{ id: crypto.randomUUID(), role: "user", content: prompt }],
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, textPreview: text.slice(0, 300) };
}

async function main() {
  const [promptsPath, manifestPath, outPath] = process.argv.slice(2);
  if (!promptsPath || !manifestPath || !outPath) {
    throw new Error("Usage: node run-v3-generation.mjs <prompts.v3.jsonl> <seed-manifest.json> <out.jsonl>");
  }

  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw.slice(manifestRaw.indexOf("{")));
  const rows = readFileSync(promptsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  // Resume support: skip (id, tier) pairs already present in outPath.
  const done = new Set();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean)) {
      try {
        const r = JSON.parse(line);
        done.add(`${r.promptId}:${r.tier}`);
      } catch {
        /* skip malformed */
      }
    }
  } else {
    writeFileSync(outPath, "");
  }

  console.log(`Resuming with ${done.size} already-completed (promptId,tier) pairs`);
  const cookies = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log("Signed in as", ADMIN_EMAIL);

  let ok = 0, err = 0, skipped = 0;
  for (const row of rows) {
    const slug = themeToSlug[row.course_theme];
    const courseId = manifest[slug]?.courseId;
    if (!courseId) {
      console.log(`SKIP ${row.id}: no courseId for theme ${row.course_theme}`);
      continue;
    }
    for (const tier of TIERS_TO_RUN) {
      const model = TIER_MODELS[tier];
      const key = `${row.id}:${tier}`;
      if (done.has(key)) { skipped++; continue; }
      const tag = `${row.id}-${tier}-${Date.now()}`;
      const energyArmed = await measureStart(tier, tag);
      const t0 = Date.now();
      try {
        const result = await chatOnce(cookies, { model, courseId, prompt: row.prompt });
        const latencyMs = Date.now() - t0;
        const energy = energyArmed ? await measureStop(tier, tag) : null;
        const answer = result.json?.text ?? result.json?.content ?? null;
        // /api/chat's non-streaming JSON body includes the AI SDK's raw `usage`
        // object (promptTokens/completionTokens/totalTokens, sometimes under
        // inputTokens/outputTokens depending on provider normalization), plus
        // ragTopSimilarity/ragChunkCount from the course-RAG prefetch that
        // always runs for chatMode: "course" regardless of routing mode.
        const usage = result.json?.usage ?? null;
        const promptTokens = usage?.promptTokens ?? usage?.inputTokens ?? null;
        const completionTokens = usage?.completionTokens ?? usage?.outputTokens ?? null;
        const totalTokens = usage?.totalTokens ?? (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);
        const record = {
          promptId: row.id,
          tier,
          model,
          courseId,
          courseTheme: row.course_theme,
          category: row.category,
          stratum: row.stratum,
          questionType: row.question_type,
          promptTokens,
          completionTokens,
          totalTokens,
          ragTopSimilarity: result.json?.ragTopSimilarity ?? null,
          ragChunkCount: result.json?.ragChunkCount ?? null,
          status: result.status,
          latencyMs,
          answer,
          error: result.status !== 200 ? result.textPreview : null,
          energyJoules: energy?.energyJoules ?? null,
          joulesCpu: energy?.joulesCpu ?? null,
          joulesGpu: energy?.joulesGpu ?? null,
          energySource: energy?.source ?? null,
          carbonGramsCO2: energy?.carbonGramsCO2 ?? null,
        };
        appendFileSync(outPath, JSON.stringify(record) + "\n");
        if (result.status === 200 && answer) {
          ok++;
          console.log(`OK   ${row.id} [${tier}] ${latencyMs}ms len=${answer.length}`);
        } else {
          err++;
          console.log(`ERR  ${row.id} [${tier}] status=${result.status} ${result.textPreview.slice(0, 120)}`);
        }
      } catch (e) {
        err++;
        if (energyArmed) await measureStop(tier, tag); // avoid leaving a dangling session (sidecar serializes to one active measurement)
        appendFileSync(
          outPath,
          JSON.stringify({ promptId: row.id, tier, model, status: 0, error: String(e) }) + "\n",
        );
        console.log(`FAIL ${row.id} [${tier}]: ${e}`);
      }
    }
  }
  console.log(`\nDone. ok=${ok} err=${err} skipped(resumed)=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
