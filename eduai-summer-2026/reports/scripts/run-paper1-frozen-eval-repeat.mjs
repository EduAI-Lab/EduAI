#!/usr/bin/env node
/**
 * Run N repeated frozen eval invocations for one arm (baseline / prompt-only / oversight).
 *
 * Usage:
 *   node eduai-summer-2026/reports/scripts/run-paper1-frozen-eval-repeat.mjs \
 *     --arm baseline --repeats 5 --model google:gemini-2.5-flash \
 *     --scenarios S1,S2,S3,S5,S2L \
 *     --out-root eval-runs/paper1-repeat-v2/gemini-2.5-flash
 *
 * Requires EDUAI_COOKIE + EDUAI_API_KEYS_JSON (+ EDUAI_COURSE_ID) in env.
 * Run each arm separately with matching ADHD_ASSIST_OVERSIGHT on the dev server.
 */

import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const EVAL_SCRIPT = path.join(REPO_ROOT, "apps/core/scripts/eval-adhd-assist.mjs");

const ARM_CONFIG = {
  baseline: { mode: "baseline", label: "paper1-repeat-baseline", dirName: "baseline" },
  "prompt-only": { mode: "assist-prompt-only", label: "paper1-repeat-prompt-only", dirName: "prompt-only" },
  oversight: { mode: "assist-oversight", label: "paper1-repeat-oversight", dirName: "oversight" },
};

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

async function signIn(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      email: process.env.EDUAI_EMAIL ?? "student1@eduai.local",
      password: process.env.EDUAI_PASSWORD ?? "EduAI2026!",
      rememberMe: true,
    }),
  });
  if (!res.ok) fail(`login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const jar = new Map();
  for (const h of cookies) {
    const part = h.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (!jar.size) fail("login returned no cookies");
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function main() {
  const { values } = parseArgs({
    options: {
      arm: { type: "string" },
      repeats: { type: "string", default: "5" },
      model: { type: "string" },
      scenarios: { type: "string", default: "S1,S2,S3,S5,S2L" },
      "out-root": { type: "string" },
      "skip-login": { type: "boolean", default: false },
    },
  });

  const armKey = values.arm;
  if (!armKey || !ARM_CONFIG[armKey]) {
    fail(`--arm required (${Object.keys(ARM_CONFIG).join(" | ")})`);
  }
  const repeats = Number(values.repeats);
  if (!Number.isFinite(repeats) || repeats < 1) fail("--repeats must be >= 1");

  const model = values.model ?? process.env.EDUAI_MODEL ?? fail("--model or EDUAI_MODEL required");
  const baseUrl = process.env.EDUAI_BASE_URL ?? "http://localhost:3000";
  const apiKeysJson = process.env.EDUAI_API_KEYS_JSON ?? fail("EDUAI_API_KEYS_JSON required");
  const courseId = process.env.EDUAI_COURSE_ID ?? "seed_course_cosc101";

  const modelSlug = model.replace(/[:/]/g, "-");
  const outRoot = values["out-root"]
    ? path.resolve(REPO_ROOT, values["out-root"])
    : path.join(REPO_ROOT, "eval-runs", "paper1-repeat-v2", modelSlug, ARM_CONFIG[armKey].dirName);

  await mkdir(outRoot, { recursive: true });

  const cookie =
    values["skip-login"] && process.env.EDUAI_COOKIE
      ? process.env.EDUAI_COOKIE
      : await signIn(baseUrl);

  const cfg = ARM_CONFIG[armKey];
  const manifest = {
    arm: armKey,
    mode: cfg.mode,
    model,
    repeats,
    scenarios: values.scenarios.split(",").map((s) => s.trim()),
    baseUrl,
    courseId,
    startedAt: new Date().toISOString(),
    runs: [],
  };

  process.stderr.write(
    `[repeat] ${armKey} × ${repeats} runs | model=${model} | scenarios=${manifest.scenarios.join(",")}\n`,
  );

  for (let i = 1; i <= repeats; i += 1) {
    const runDir = path.join(outRoot, `run-${String(i).padStart(2, "0")}`);
    const label = `${cfg.label}-r${String(i).padStart(2, "0")}`;
    process.stderr.write(`[repeat] run ${i}/${repeats} → ${path.relative(REPO_ROOT, runDir)}\n`);

    const result = spawnSync(
      "npx",
      [
        "tsx",
        EVAL_SCRIPT,
        "--only",
        manifest.scenarios.join(","),
        "--mode",
        cfg.mode,
        "--label",
        label,
        "--out",
        runDir,
      ],
      {
        cwd: path.join(REPO_ROOT, "apps/core"),
        env: {
          ...process.env,
          EDUAI_BASE_URL: baseUrl,
          EDUAI_COOKIE: cookie,
          EDUAI_MODEL: model,
          EDUAI_COURSE_ID: courseId,
          EDUAI_API_KEYS_JSON: apiKeysJson,
        },
        stdio: "inherit",
      },
    );

    if (result.status !== 0) fail(`run ${i} exited ${result.status ?? "unknown"}`);
    manifest.runs.push({ index: i, dir: path.relative(REPO_ROOT, runDir), label });
  }

  manifest.finishedAt = new Date().toISOString();
  await writeFile(path.join(outRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Done. Manifest: ${path.relative(REPO_ROOT, path.join(outRoot, "manifest.json"))}\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
