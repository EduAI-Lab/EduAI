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
 *   node scripts/eval-adhd-assist.mjs --only S4 --mode off   # Phase 2.5 tool-heavy sanity (#261)
 */

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeAdhdResponseMetrics,
  isProfileStructuralPass,
  isStructuralCompliancePass,
} from "../app/lib/ai/adhd-metrics.ts";
import { resolveAdhdTurnProfile, getProfileRequirements } from "../app/lib/ai/adhd-turn-profile.ts";
import {
  ALL_CONDITIONS,
  CONDITIONS,
  EvalAdhdAssistModeError,
  resolveConditions as resolveConditionsCore,
} from "../app/lib/eval/eval-adhd-assist-conditions.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Source of truth: docs/literature/form-a-scenario-test-sheet.md (S1, S2, S3, S5).
// S4: tool-heavy probes aligned with MODEL_LATENCY_TRACKER.md until form-a-eval-scenarios.md lands.
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
  S4: [
    `Search the web for the latest news on GPT-5.5 and summarize the top result.`,
    `Open the most relevant URL from that search with fetchPage and give me three bullet points from the page.`,
    `Find recent papers on transformer architectures and summarize the top result with source URLs.`,
  ],
};

/**
 * Contextual shape expectations for Form A qual scoring.
 * Dean (Phase 3 v2) would classify turn type; eval uses these until then.
 */
const TURN_SHAPE = {
  "S1.t1": { expectFullStructure: true, label: "tutoring answer" },
  "S2.t1": { expectFullStructure: true, label: "step ladder" },
  "S2.t2": { expectFullStructure: false, label: "redirect / one-topic boundary" },
  "S2.t3": { expectFullStructure: true, label: "focused step answer" },
  "S3.t1": { expectFullStructure: true, label: "plan + step ladder" },
  "S3.t2": { expectFullStructure: true, label: "plan continuation" },
  "S5.t1": { expectFullStructure: true, label: "brief clarification" },
  "S5.t2": { expectFullStructure: true, label: "rephrase consistency check" },
};

const USAGE = `Usage: node scripts/eval-adhd-assist.mjs [options]

Options:
  --only <ids>       Comma-separated scenario IDs (default: S1,S2,S3)
  --include-s5       Also run scenario S5
  --include-s4       Also run scenario S4 (Phase 2.5 tool-heavy validation)
  --mode <m>         baseline | assist-prompt-only | assist-oversight | all-three\n                     (default: both — legacy off/on/both aliases still accepted)
  --label <name>     Run label in meta (e.g. phase3-after-oversight)
  --out <dir>        Output directory (default: eval-runs/<ISO>)
  --no-write         Skip writing transcripts; print table only
  --help             Show this help and exit

Required environment variables:
  EDUAI_COOKIE          Cookie header from a logged-in browser session
  EDUAI_API_KEYS_JSON   JSON, e.g. {"openai":{"isEnabled":true,"apiKey":"sk-..."}}

Optional environment variables:
  EDUAI_BASE_URL        Default http://localhost:5173 (core dev: http://localhost:3000)
  EDUAI_MODEL           Default openai:gpt-4o-mini
  EDUAI_COURSE_ID       Course id for /api/chat (required when API enforces course context)
  EDUAI_COURSE_CODE     Alternative: resolve course by code (e.g. COSC101)

Phase 3 after-capture (oversight ON on server):
  EDUAI_BASE_URL=http://localhost:3000 \\
  EDUAI_COOKIE='...' \\
  EDUAI_MODEL=google:gemini-2.5-flash \\
  EDUAI_API_KEYS_JSON='{"google":{...}}' \\
  npm run eval:adhd -- --only S1,S2,S3,S5 --mode on --label phase3-after-oversight

Then record Form A:
  npx tsx ../../eduai-summer-2026/reports/scripts/record-form-a-phase3.mjs \\
    --baseline ../../eval-runs/2026-06-09T21-14-53-136Z \\
    --after ../../eval-runs/<AFTER_STAMP>
`;

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      "include-s5": { type: "boolean", default: false },
      "include-s4": { type: "boolean", default: false },
      mode: { type: "string", default: "both" },
      label: { type: "string" },
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

function resolveConditions(rawMode) {
  try {
    return resolveConditionsCore(rawMode, {
      onWarn: (message) => {
        process.stderr.write(`${message}\n`);
      },
    });
  } catch (err) {
    if (err instanceof EvalAdhdAssistModeError) {
      fail(err.message);
    }
    throw err;
  }
}

/** @param {import("../app/lib/eval/eval-adhd-assist-conditions.ts").EvalCondition} condition */
function conditionToRunMode(condition) {
  if (condition === "baseline") return "off";
  if (condition === "assist-oversight") return "on";
  return "assist-prompt-only";
}

/** @param {string} runMode */
function runModeToConditionLabel(runMode) {
  const condition =
    runMode === "off"
      ? "baseline"
      : runMode === "on"
        ? "assist-oversight"
        : "assist-prompt-only";
  return CONDITIONS[condition].label;
}

function warnOversightExpectation(condition) {
  const cfg = CONDITIONS[condition];
  if (cfg.requiresOversight === false) {
    process.stderr.write(
      `[${condition}] Ensure EduAI core has ADHD_ASSIST_OVERSIGHT=false (prompt-only; no second-pass rewrite).\n`,
    );
  } else if (cfg.requiresOversight === true) {
    process.stderr.write(
      `[${condition}] Ensure EduAI core has ADHD_ASSIST_OVERSIGHT unset or true (oversight ON).\n`,
    );
  }
}

function conditionOutDir(outRoot, condition) {
  return path.join(outRoot, CONDITIONS[condition].dirName);
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
  if (cli["include-s4"] && !scenarioIds.includes("S4")) scenarioIds.push("S4");

  for (const id of scenarioIds) {
    if (!SCENARIOS[id]) fail(`Unknown scenario "${id}". Known: ${Object.keys(SCENARIOS).join(", ")}`);
  }

  const conditions = resolveConditions(cli.mode);
  if (conditions.length === ALL_CONDITIONS.length) {
    process.stderr.write(
      "note: all-three runs every condition in one process. " +
        "Assist arms need matching ADHD_ASSIST_OVERSIGHT on the server — " +
        "prefer three separate invocations with server restarts (see script header).\n",
    );
  }
  const modes = conditions.map(conditionToRunMode);

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
    conditions,
    modes,
    label: cli.label?.trim() || null,
    outDir,
    write: !cli["no-write"],
    isoStamp,
  };
}

function turnKey(scenarioId, turnIndex) {
  return `${scenarioId}.t${turnIndex + 1}`;
}

function oversightMetaFromEnv() {
  const raw = process.env.ADHD_ASSIST_OVERSIGHT?.trim().toLowerCase();
  const disabled =
    raw === "false" || raw === "0" || raw === "no" || raw === "off";
  return {
    enabled: !disabled,
    envValue: process.env.ADHD_ASSIST_OVERSIGHT ?? "(default on)",
  };
}

/** Qual pass: profile-conditional when assist is on; legacy TURN_SHAPE fallback otherwise. */
function evaluateContextualPass(turnRef, metrics, assistantText, { adhdAssist, priorAssistantText, userText }) {
  const shape = TURN_SHAPE[turnRef];
  if (!shape) {
    return { expectedShape: "unknown", contextualPass: null, responseProfile: null };
  }

  if (adhdAssist) {
    const responseProfile = resolveAdhdTurnProfile({
      userText,
      priorAssistantText,
    });
    const wordCap = getProfileRequirements(responseProfile).wordCap;
    const profileMetrics = computeAdhdResponseMetrics(assistantText, { wordCap });
    return {
      expectedShape: shape.label,
      contextualPass: isProfileStructuralPass(
        profileMetrics,
        responseProfile,
        assistantText,
      ),
      responseProfile,
    };
  }

  if (shape.expectFullStructure) {
    return {
      expectedShape: shape.label,
      contextualPass: isStructuralCompliancePass(metrics),
      responseProfile: null,
    };
  }
  const hasRedirectCue = /separate question|one topic|come back|switch now/i.test(
    assistantText,
  );
  const overStructured = metrics.topSummary && metrics.wordCount > 60;
  return {
    expectedShape: shape.label,
    contextualPass: !overStructured && (hasRedirectCue || !metrics.topSummary),
    responseProfile: null,
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
    ...(process.env.EDUAI_COURSE_ID ? { courseId: process.env.EDUAI_COURSE_ID } : {}),
    ...(process.env.EDUAI_COURSE_CODE ? { courseCode: process.env.EDUAI_COURSE_CODE } : {}),
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
  return computeAdhdResponseMetrics(assistantText);
}

function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function runScenarioMode({ config, scenarioId, mode }) {
  const turns = SCENARIOS[scenarioId];
  const adhdAssist = mode !== "off";
  const transcript = [];
  const turnResults = [];
  let chatId;
  let lastAssistantText = "";
  let priorAssistantText = "";
  let lastResponseMeta = null;
  let errorForTurn = null;

  for (let i = 0; i < turns.length; i++) {
    const userText = turns[i];
    const tStart = Date.now();
    const turnRef = turnKey(scenarioId, i);
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
      const metrics = computeMetrics(lastAssistantText);
      const structuralPass = isStructuralCompliancePass(metrics);
      const { expectedShape, contextualPass, responseProfile } = evaluateContextualPass(
        turnRef,
        metrics,
        lastAssistantText,
        { adhdAssist, priorAssistantText, userText },
      );
      turnResults.push({
        scenarioId,
        mode,
        turn: i + 1,
        turnRef,
        userText,
        assistantText: lastAssistantText,
        elapsedMs: elapsed,
        metrics,
        structuralPass,
        expectedShape,
        contextualPass,
        responseProfile,
        responseMeta: lastResponseMeta,
      });
      transcript.push({
        userText,
        assistantText: lastAssistantText,
        turnRef,
        metrics,
        structuralPass,
        expectedShape,
        contextualPass,
        responseProfile,
      });
      process.stderr.write(
        `[${scenarioId}.t${i + 1} mode=${mode}] struct=${structuralPass ? "Y" : "N"} ctx=${contextualPass === null ? "-" : contextualPass ? "Y" : "N"} profile=${responseProfile ?? "-"} ${lastAssistantText.length} chars in ${elapsed} ms\n`,
      );
      priorAssistantText = lastAssistantText;
    } catch (err) {
      const elapsed = Date.now() - tStart;
      errorForTurn = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${scenarioId}.t${i + 1} mode=${mode}] ERROR in ${elapsed} ms: ${errorForTurn}\n`,
      );
      transcript.push({ userText, assistantText: `<<ERROR: ${errorForTurn}>>`, turnRef, metrics: null, structuralPass: false, expectedShape: null, contextualPass: false });
      turnResults.push({
        scenarioId,
        mode,
        turn: i + 1,
        turnRef,
        elapsedMs: elapsed,
        metrics: null,
        structuralPass: false,
        expectedShape: TURN_SHAPE[turnRef]?.label ?? null,
        contextualPass: false,
        error: errorForTurn,
      });
      break;
    }
  }

  const metrics = computeMetrics(lastAssistantText);
  return {
    scenarioId,
    mode,
    chatId: chatId ?? null,
    transcript,
    turnResults,
    metrics,
    meta: lastResponseMeta,
    error: errorForTurn,
  };
}

function formatTable(results) {
  const header = `| Scenario | Mode | Turn | Words | TopSummary | Next? | UnderCap | Strict | Contextual |\n| --- | --- | ---: | ---: | :---: | :---: | :---: | :---: | :---: |`;
  const rows = [];
  for (const r of results) {
    if (r.error) {
      rows.push(`| ${r.scenarioId} | ${r.mode} | — | — | — | — | — | ERROR | ERROR |`);
      continue;
    }
    for (const t of r.turnResults ?? []) {
      const m = t.metrics ?? { wordCount: 0, topSummary: false, nextLine: false, underCap: false };
      rows.push(
        `| ${r.scenarioId} | ${r.mode} | ${t.turn} | ${m.wordCount} | ${m.topSummary ? "Y" : "N"} | ${m.nextLine ? "Y" : "N"} | ${m.underCap ? "Y" : "N"} | ${t.structuralPass ? "Y" : "N"} | ${t.contextualPass === null ? "-" : t.contextualPass ? "Y" : "N"} |`,
      );
    }
  }
  return [header, ...rows].join("\n");
}

function summarizeTurnPasses(results) {
  const turns = results.flatMap((r) => r.turnResults ?? []);
  const onTurns = turns.filter((t) => t.mode !== "off" && !t.error);
  const strictPass = onTurns.filter((t) => t.structuralPass).length;
  const ctxPass = onTurns.filter((t) => t.contextualPass).length;
  const ctxScored = onTurns.filter((t) => t.contextualPass !== null).length;
  return { onTurns, strictPass, ctxPass, ctxScored };
}

function passRateLines(results) {
  const { onTurns, strictPass, ctxPass, ctxScored } = summarizeTurnPasses(results);
  if (onTurns.length === 0) {
    return [
      "ADHD Assist ON strict structural pass: 0/0 turns.",
      "ADHD Assist ON contextual shape pass: 0/0 turns.",
    ];
  }
  return [
    `ADHD Assist ON strict structural pass: ${strictPass}/${onTurns.length} turns (TopSummary && Next? && UnderCap).`,
    `ADHD Assist ON contextual shape pass: ${ctxPass}/${ctxScored} scored turns (see TURN_SHAPE in eval script).`,
  ];
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
    if (t.metrics) {
      lines.push("");
      lines.push(`- turnRef: ${t.turnRef}`);
      lines.push(`- strict structural pass: ${t.structuralPass ? "Y" : "N"}`);
      lines.push(`- expected shape: ${t.expectedShape ?? "—"}`);
      lines.push(`- contextual pass: ${t.contextualPass === null ? "—" : t.contextualPass ? "Y" : "N"}`);
    }
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
    "Turn",
    "Turn script ref",
    "Output link",
    "Quant: word count",
    "Quant: Top summary Y/N",
    "Quant: Next? Y/N",
    "Quant: strict pass Y/N",
    "Quant: contextual pass Y/N",
    "Qual: expected shape",
    "Qual: notes",
  ];
  const lines = [headers.map(escapeCsv).join(",")];
  for (const r of results) {
    const fileBase = `${r.scenarioId}-${r.mode}.md`;
    const rel = path.relative(outDir, path.join(outDir, fileBase));
    for (const t of r.turnResults ?? []) {
      const m = t.metrics ?? { wordCount: "", topSummary: false, nextLine: false };
      lines.push(
        [
          `${r.scenarioId}-${r.mode}-t${t.turn}`,
          r.scenarioId,
          "EduAI /chat",
          runModeToConditionLabel(r.mode),
          t.turn,
          `form-a-scenario-test-sheet.md#${r.scenarioId}`,
          rel,
          m.wordCount,
          m.topSummary ? "Y" : "N",
          m.nextLine ? "Y" : "N",
          t.structuralPass ? "Y" : "N",
          t.contextualPass === null ? "" : t.contextualPass ? "Y" : "N",
          t.expectedShape ?? "",
          "",
        ].map(escapeCsv).join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

function buildFormASnapshot({ config, results }) {
  const { onTurns, strictPass, ctxPass, ctxScored } = summarizeTurnPasses(results);
  const lines = [];
  lines.push("# Form A eval snapshot (single run)");
  lines.push("");
  lines.push(`- label: ${config.label ?? "(none)"}`);
  lines.push(`- gitSha: ${gitSha() ?? "?"}`);
  lines.push(`- model: ${config.model}`);
  lines.push(`- oversight: ${JSON.stringify(oversightMetaFromEnv())}`);
  lines.push(`- scenarios: ${config.scenarioIds.join(", ")}`);
  lines.push(`- modes: ${config.modes.join(", ")}`);
  lines.push("");
  lines.push("## Assist ON turn scores");
  lines.push("");
  lines.push(`- strict structural: ${strictPass}/${onTurns.length}`);
  lines.push(`- contextual shape: ${ctxPass}/${ctxScored}`);
  lines.push("");
  lines.push("| Turn | Strict | Contextual | Expected shape |");
  lines.push("| --- | :---: | :---: | --- |");
  for (const t of onTurns) {
    lines.push(
      `| ${t.turnRef} | ${t.structuralPass ? "Y" : "N"} | ${t.contextualPass === null ? "—" : t.contextualPass ? "Y" : "N"} | ${t.expectedShape ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("Pair with baseline via `record-form-a-phase3.mjs` for IURA Form A before/after table.");
  lines.push("");
  return lines.join("\n");
}

async function writeOutputs({ config, results }) {
  if (!config.write) return;
  await mkdir(config.outDir, { recursive: true });

  const useConditionDirs = config.conditions.length > 1;

  const oversight = oversightMetaFromEnv();
  const meta = {
    timestamp: new Date().toISOString(),
    gitSha: gitSha(),
    baseUrl: config.baseUrl,
    model: config.model,
    label: config.label,
    scenarios: config.scenarioIds,
    modes: config.modes,
    oversight,
    env: {
      EDUAI_COOKIE_present: Boolean(process.env.EDUAI_COOKIE),
      EDUAI_API_KEYS_JSON_present: Boolean(process.env.EDUAI_API_KEYS_JSON),
      EDUAI_BASE_URL_present: Boolean(process.env.EDUAI_BASE_URL),
      EDUAI_MODEL_present: Boolean(process.env.EDUAI_MODEL),
      ADHD_ASSIST_OVERSIGHT: process.env.ADHD_ASSIST_OVERSIGHT ?? null,
    },
  };
  await writeFile(path.join(config.outDir, "run-meta.json"), JSON.stringify(meta, null, 2));

  const allTurnResults = results.flatMap((r) => r.turnResults ?? []);
  await writeFile(
    path.join(config.outDir, "turn-results.json"),
    JSON.stringify(allTurnResults, null, 2),
  );

  if (useConditionDirs) {
    for (let i = 0; i < config.conditions.length; i++) {
      const condition = config.conditions[i];
      const mode = config.modes[i];
      const dir = conditionOutDir(config.outDir, condition);
      await mkdir(dir, { recursive: true });
      const subset = results.filter((r) => r.mode === mode);
      for (const r of subset) {
        const file = path.join(dir, `${r.scenarioId}-${r.mode}.md`);
        await writeFile(file, buildTranscriptMd(r));
      }
      await writeFile(path.join(dir, "results.csv"), buildCsv(subset, dir));
    }
    await writeFile(
      path.join(config.outDir, "results.csv"),
      buildCsv(results, config.outDir),
    );
  } else {
    for (const r of results) {
      const file = path.join(config.outDir, `${r.scenarioId}-${r.mode}.md`);
      await writeFile(file, buildTranscriptMd(r));
    }
    await writeFile(path.join(config.outDir, "results.csv"), buildCsv(results, config.outDir));
  }
  await writeFile(
    path.join(config.outDir, "form-a-snapshot.md"),
    buildFormASnapshot({ config, results }),
  );
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

  for (let i = 0; i < config.conditions.length; i++) {
    const condition = config.conditions[i];
    const mode = config.modes[i];
    warnOversightExpectation(condition);
    for (const scenarioId of config.scenarioIds) {
      const result = await runScenarioMode({ config, scenarioId, mode });
      activeResults.push(result);
    }
  }

  await writeOutputs({ config, results: activeResults });

  const table = formatTable(activeResults);
  process.stdout.write(table + "\n\n");
  for (const line of passRateLines(activeResults)) {
    process.stdout.write(line + "\n");
  }
  if (config.write) {
    process.stdout.write(`\nOutputs written to: ${config.outDir}\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
