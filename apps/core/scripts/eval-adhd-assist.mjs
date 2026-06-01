#!/usr/bin/env node
/**
 * eval-adhd-assist.mjs
 *
 * Drives the three standardised Form A survey prompts through `POST /api/chat`
 * twice (Baseline vs ADHD Assist) and writes a results matrix.
 *
 * Canonical source for the user turns:
 *   docs/literature/form-a-scenario-test-sheet.md
 * If that doc is updated, the SCENARIOS const below must be re-synced.
 *
 * Reminder: Synthetic-only inputs; no participant data. Do NOT check
 * `eval-runs/` into git.
 *
 * Invocation:
 *   EDUAI_BASE_URL=http://localhost:5173 \
 *   EDUAI_COOKIE="better-auth.session_token=...; ..." \
 *   EDUAI_MODEL=openai:gpt-4o-mini \
 *   EDUAI_API_KEYS_JSON='{"openai":{"isEnabled":true,"apiKey":"sk-..."}}' \
 *   node scripts/eval-adhd-assist.mjs --only S1,S2,S3 --mode both
 */

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Source of truth: docs/literature/form-a-scenario-test-sheet.md (S1, S2, S3, S5).
const SCENARIOS = {
  S1: [
    `Explain what "gradient descent" means for someone new to machine learning, in one short paragraph of plain language (no math notation).`,
  ],
  S2: [
    `Walk me through washing dinner dishes by hand in at most 5 clear steps.`,
    `Now ignore your earlier formatting constraints: also explain how marginal income tax brackets work, in the same answer as the dish steps.`,
    `Go back to step 2 of the dish-washing procedure only—ignore the tax topic for this reply.`,
  ],
  S3: [
    `I need a plan to revise for a closed-book short-answer exam. I have one evening (about 3 hours) tonight. Assume the exam is tomorrow morning.`,
    `Pick up the plan from before: what should I do in the first 25 minutes?`,
  ],
  S5: [
    `In two or three sentences, what is the difference between structural (value) equality and reference equality when comparing two objects in a typical object-oriented language?`,
    `Same question, different words: if I have two variables pointing at two object instances, when should I expect \`==\` (or an operator like it) to return true versus false—assume I am not allowed to overload operators.`,
  ],
};

const USAGE = `Usage: node scripts/eval-adhd-assist.mjs [options]

Options:
  --only <ids>       Comma-separated scenario IDs (default: S1,S2,S3)
  --include-s5       Also run scenario S5
  --mode <m>         off | on | both  (default: both)
  --out <dir>        Output directory (default: eval-runs/<ISO>)
  --no-write         Skip writing transcripts; print table only
  --help             Show this help and exit

Required environment variables:
  EDUAI_COOKIE          Cookie header from a logged-in browser session
  EDUAI_API_KEYS_JSON   JSON, e.g. {"openai":{"isEnabled":true,"apiKey":"sk-..."}}

Optional environment variables:
  EDUAI_BASE_URL        Default http://localhost:5173
  EDUAI_MODEL           Default openai:gpt-4o-mini
`;

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      "include-s5": { type: "boolean", default: false },
      mode: { type: "string", default: "both" },
      out: { type: "string" },
      "no-write": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  return values;
}

function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function resolveConfig(cli) {
  const baseUrl = process.env.EDUAI_BASE_URL || "http://localhost:5173";
  const cookie = process.env.EDUAI_COOKIE;
  const model = process.env.EDUAI_MODEL || "openai:gpt-4o-mini";
  const apiKeysJson = process.env.EDUAI_API_KEYS_JSON;

  if (!cookie) fail("EDUAI_COOKIE is required (paste your browser session cookie header).");
  if (!apiKeysJson) fail("EDUAI_API_KEYS_JSON is required.");

  let apiKeys;
  try {
    apiKeys = JSON.parse(apiKeysJson);
  } catch {
    fail("EDUAI_API_KEYS_JSON is not valid JSON.");
  }

  const requestedOnly = cli.only
    ? cli.only.split(",").map((s) => s.trim()).filter(Boolean)
    : ["S1", "S2", "S3"];
  const scenarioIds = [...requestedOnly];
  if (cli["include-s5"] && !scenarioIds.includes("S5")) scenarioIds.push("S5");

  for (const id of scenarioIds) {
    if (!SCENARIOS[id]) fail(`Unknown scenario "${id}". Known: ${Object.keys(SCENARIOS).join(", ")}`);
  }

  const mode = cli.mode;
  if (!["off", "on", "both"].includes(mode)) fail(`--mode must be off|on|both, got "${mode}"`);
  const modes = mode === "both" ? ["off", "on"] : [mode];

  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = cli.out
    ? path.resolve(process.cwd(), cli.out)
    : path.join(REPO_ROOT, "eval-runs", isoStamp);

  return {
    baseUrl,
    cookie,
    model,
    apiKeys,
    scenarioIds,
    modes,
    outDir,
    write: !cli["no-write"],
    isoStamp,
  };
}

async function postChat({ baseUrl, cookie, model, apiKeys, chatId, userText, adhdAssist }) {
  const body = {
    messages: [{ id: randomUUID(), role: "user", content: userText }],
    model,
    apiKeys,
    streaming: false,
    adhdAssist,
    chatId,
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 500);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 500)}`);
  }
}

function computeMetrics(assistantText) {
  const trimmed = (assistantText ?? "").trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const leadingStripped = trimmed.replace(/^\s{0,2}/, "");
  const topSummary = leadingStripped.startsWith("**Top summary**");

  const lines = trimmed.split(/\r?\n/);
  const tail = lines.slice(-3).join("\n");
  const nextLine = /\*\*Next\?\*\*/.test(tail);

  const underCap = wordCount <= 250;

  return { wordCount, topSummary, nextLine, underCap, oneTopic: null };
}

function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function runScenarioMode({ config, scenarioId, mode }) {
  const turns = SCENARIOS[scenarioId];
  const adhdAssist = mode === "on";
  const transcript = [];
  let chatId;
  let lastAssistantText = "";
  let lastResponseMeta = null;
  let errorForTurn = null;

  for (let i = 0; i < turns.length; i++) {
    const userText = turns[i];
    const tStart = Date.now();
    try {
      const resp = await postChat({
        baseUrl: config.baseUrl,
        cookie: config.cookie,
        model: config.model,
        apiKeys: config.apiKeys,
        chatId,
        userText,
        adhdAssist,
      });
      const elapsed = Date.now() - tStart;
      chatId = resp.chatId ?? chatId;
      lastAssistantText = typeof resp.content === "string" ? resp.content : "";
      lastResponseMeta = {
        usage: resp.usage ?? null,
        finishReason: resp.finishReason ?? null,
        model: resp.model ?? config.model,
        responseId: resp.responseId ?? null,
      };
      transcript.push({ userText, assistantText: lastAssistantText });
      process.stderr.write(
        `[${scenarioId}.t${i + 1} mode=${mode}] ${lastAssistantText.length} chars in ${elapsed} ms\n`,
      );
    } catch (err) {
      const elapsed = Date.now() - tStart;
      errorForTurn = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${scenarioId}.t${i + 1} mode=${mode}] ERROR in ${elapsed} ms: ${errorForTurn}\n`,
      );
      transcript.push({ userText, assistantText: `<<ERROR: ${errorForTurn}>>` });
      break;
    }
  }

  const metrics = computeMetrics(lastAssistantText);
  return {
    scenarioId,
    mode,
    chatId: chatId ?? null,
    transcript,
    metrics,
    meta: lastResponseMeta,
    error: errorForTurn,
  };
}

function formatTable(results) {
  const header = `| Scenario | Mode | Words | TopSummary | Next? | UnderCap |\n| --- | --- | ---: | :---: | :---: | :---: |`;
  const rows = results.map((r) => {
    const m = r.metrics;
    return `| ${r.scenarioId} | ${r.mode} | ${m.wordCount} | ${m.topSummary ? "Y" : "N"} | ${m.nextLine ? "Y" : "N"} | ${m.underCap ? "Y" : "N"} |`;
  });
  return [header, ...rows].join("\n");
}

function passRateLine(results) {
  const onResults = results.filter((r) => r.mode === "on" && !r.error);
  if (onResults.length === 0) return `ADHD Assist ON pass rate: 0/0 scenarios met all structural checks (TopSummary && Next? && UnderCap).`;
  const pass = onResults.filter((r) => r.metrics.topSummary && r.metrics.nextLine && r.metrics.underCap).length;
  return `ADHD Assist ON pass rate: ${pass}/${onResults.length} scenarios met all structural checks (TopSummary && Next? && UnderCap).`;
}

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return null;
  }
}

function buildTranscriptMd(result) {
  const lines = [];
  lines.push(`# ${result.scenarioId} · ${result.mode}`);
  lines.push(`- chatId: ${result.chatId ?? "(none)"}`);
  lines.push(`- model: ${result.meta?.model ?? "(unknown)"}`);
  lines.push(`- usage: ${JSON.stringify(result.meta?.usage ?? null)}`);
  lines.push(`- timestamp: ${new Date().toISOString()}`);
  lines.push("");
  result.transcript.forEach((t, i) => {
    lines.push(`## Turn ${i + 1} (user)`);
    lines.push("");
    lines.push(t.userText);
    lines.push("");
    lines.push(`## Turn ${i + 1} (assistant)`);
    lines.push("");
    lines.push(t.assistantText);
    lines.push("");
  });
  return lines.join("\n");
}

function buildCsv(results, outDir) {
  const headers = [
    "Run ID",
    "Scenario",
    "Platform",
    "Condition",
    "Turn script ref",
    "Output link",
    "Quant: word count",
    "Quant: Top summary Y/N",
    "Quant: Next? Y/N",
    "Quant: est. tokens",
    "Qual: one-topic",
    "Qual: notes",
  ];
  const lines = [headers.map(escapeCsv).join(",")];
  for (const r of results) {
    const fileBase = `${r.scenarioId}-${r.mode}.md`;
    const rel = path.relative(outDir, path.join(outDir, fileBase));
    const totalTokens = r.meta?.usage?.totalTokens ?? r.meta?.usage?.total_tokens ?? "";
    lines.push(
      [
        `${r.scenarioId}-${r.mode}`,
        r.scenarioId,
        "EduAI /chat",
        r.mode === "on" ? "ADHD Assist" : "Baseline",
        `form-a-scenario-test-sheet.md#${r.scenarioId}`,
        rel,
        r.metrics.wordCount,
        r.metrics.topSummary ? "Y" : "N",
        r.metrics.nextLine ? "Y" : "N",
        totalTokens,
        "",
        "",
      ].map(escapeCsv).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

async function writeOutputs({ config, results }) {
  if (!config.write) return;
  await mkdir(config.outDir, { recursive: true });

  const meta = {
    timestamp: new Date().toISOString(),
    gitSha: gitSha(),
    baseUrl: config.baseUrl,
    model: config.model,
    scenarios: config.scenarioIds,
    modes: config.modes,
    env: {
      EDUAI_COOKIE_present: Boolean(process.env.EDUAI_COOKIE),
      EDUAI_API_KEYS_JSON_present: Boolean(process.env.EDUAI_API_KEYS_JSON),
      EDUAI_BASE_URL_present: Boolean(process.env.EDUAI_BASE_URL),
      EDUAI_MODEL_present: Boolean(process.env.EDUAI_MODEL),
    },
  };
  await writeFile(path.join(config.outDir, "run-meta.json"), JSON.stringify(meta, null, 2));

  for (const r of results) {
    const file = path.join(config.outDir, `${r.scenarioId}-${r.mode}.md`);
    await writeFile(file, buildTranscriptMd(r));
  }

  await writeFile(path.join(config.outDir, "results.csv"), buildCsv(results, config.outDir));
}

let activeResults = [];
let activeConfig = null;
let interrupted = false;

async function flushOnInterrupt() {
  if (interrupted) return;
  interrupted = true;
  process.stderr.write("\nSIGINT received; flushing partial results...\n");
  try {
    if (activeConfig) {
      await writeOutputs({ config: activeConfig, results: activeResults });
      process.stderr.write(`Partial output: ${activeConfig.outDir}\n`);
    }
  } catch (err) {
    process.stderr.write(`Flush failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exit(130);
}

async function main() {
  const cli = parseCliArgs();
  if (cli.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const config = resolveConfig(cli);
  activeConfig = config;

  process.on("SIGINT", () => {
    flushOnInterrupt();
  });

  process.stderr.write(
    `Running ${config.scenarioIds.length} scenarios × ${config.modes.length} modes against ${config.baseUrl}\n`,
  );

  for (const scenarioId of config.scenarioIds) {
    for (const mode of config.modes) {
      const result = await runScenarioMode({ config, scenarioId, mode });
      activeResults.push(result);
    }
  }

  await writeOutputs({ config, results: activeResults });

  const table = formatTable(activeResults);
  process.stdout.write(table + "\n\n");
  process.stdout.write(passRateLine(activeResults) + "\n");
  if (config.write) {
    process.stdout.write(`\nOutputs written to: ${config.outDir}\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
