#!/usr/bin/env node
/**
 * Model adequacy ladder runs — arbitrary models × filtered prompts.
 *
 * Two backends (first match wins):
 *   1. Direct LiteLLM/vLLM — set RESEARCH_VLLM_BASE_URL (e.g. http://cmps02.ok.ubc.ca:8001)
 *   2. EduAI /api/chat — set RESEARCH_RUN_URL + auth (RAG, tools, routing telemetry)
 *
 * Models (comma-separated RESEARCH_ADEQUACY_MODELS):
 *   Direct:  qwen2.5-72b-instruct, qwen2.5-14b-instruct (LiteLLM served names)
 *   EduAI:   vllm:qwen2.5-72b-instruct, vllm:qwen2.5-14b-instruct
 *
 * Filters:
 *   RESEARCH_RUN_SPLIT       dev | test | all (default all)
 *   RESEARCH_RUN_STRATUM     easy | medium | hard | comma list
 *   RESEARCH_RUN_TIER_SENSITIVE=1  only strict-label tier_sensitive prompts (needs labels file)
 *   RESEARCH_RUN_IDS         comma ts-### list
 *   RESEARCH_RUN_LIMIT
 *
 * Output: RESEARCH_RUN_OUT (default docs/research/data/runs/adequacy/adequacy-runs.jsonl)
 * Label:  RESEARCH_RUN_LABEL (default adequacy-v1)
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { PROMPTS_PATH, resolveRunsFile } from "./paths.mjs";
import {
  ensureResearchEnergyReady,
  flattenEnergyFields,
  isEnergyMeasurementEnabled,
  withEnergyMeasurement,
} from "./energy-sidecar.mjs";
import {
  resolveResearchChatFlags,
  resolveResearchTimeoutMs,
} from "./research-chat-body.mjs";

const DEFAULT_OUT = resolveRunsFile("adequacy/adequacy-runs.jsonl");
const DEFAULT_LABELS = resolveRunsFile("labels-strict.v1.jsonl");

function readEnv(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${e.message}`);
    }
  });
}

function loadPrompts() {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`prompts line ${i + 1}: ${e.message}`);
    }
  });
}

function parseModels(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((model) => {
      const lite = model.replace(/^vllm:/, "");
      return { model, lite_name: lite, tier_label: tierLabelForModel(lite) };
    });
}

function tierLabelForModel(name) {
  if (/72b/i.test(name)) return "XL";
  if (/32b/i.test(name)) return "large";
  if (/14b/i.test(name)) return "medium";
  if (/7b/i.test(name)) return "small";
  return name;
}

function extractResponseText(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.content === "string") return json.content;
  if (typeof json.text === "string") return json.text;
  if (typeof json.response === "string") return json.response;
  const choice = json.choices?.[0];
  if (choice?.message?.content) return String(choice.message.content);
  if (Array.isArray(json.messages)) {
    const last = json.messages.at(-1);
    if (last && typeof last.content === "string") return last.content;
  }
  return "";
}

async function postDirectVllm({ baseUrl, apiKey, model, prompt, timeoutMs }) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2048,
  };
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    const message = e instanceof Error ? e.message : String(e);
    return {
      httpStatus: 0,
      durationMs,
      responseText: "",
      finishReason: null,
      error: message.includes("TimeoutError") ? `Request timed out after ${timeoutMs}ms` : message,
      backend: "direct-vllm",
    };
  }
  const text = await res.text();
  const durationMs = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return {
    httpStatus: res.status,
    durationMs,
    responseText: extractResponseText(json),
    finishReason: json?.choices?.[0]?.finish_reason ?? json?.finishReason ?? null,
    error:
      json?.error?.message ??
      (res.status >= 400 ? text.slice(0, 300) : null),
    backend: "direct-vllm",
    usage: json?.usage ?? null,
  };
}

async function postEduaiChat({
  url,
  headers,
  apiKeys,
  model,
  prompt,
  courseCode,
  forceHybridRag,
  hybridWebTools,
  timeoutMs,
}) {
  const body = {
    model,
    apiKeys,
    messages: [{ id: randomUUID(), role: "user", content: prompt }],
    streaming: false,
    ...(courseCode ? { courseCode } : {}),
    ...(forceHybridRag ? { forceHybridRag: true } : {}),
    ...(hybridWebTools ? { hybridWebTools: true } : {}),
  };
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    const message = e instanceof Error ? e.message : String(e);
    return {
      httpStatus: 0,
      durationMs,
      responseText: "",
      finishReason: null,
      error: message.includes("TimeoutError") ? `Request timed out after ${timeoutMs}ms` : message,
      backend: "eduai",
      routedModel: null,
    };
  }
  const text = await res.text();
  const durationMs = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return {
    httpStatus: res.status,
    durationMs,
    responseText: extractResponseText(json),
    finishReason: json?.finishReason ?? null,
    error: json?.error ?? (res.status >= 400 ? text.slice(0, 300) : null),
    backend: "eduai",
    routedModel: res.headers.get("x-routed-model"),
    promptTokens: json?.usage?.promptTokens ?? json?.prompt_tokens ?? null,
    completionTokens: json?.usage?.completionTokens ?? json?.completion_tokens ?? null,
  };
}

function loadApiKeysJson() {
  const file = readEnv("RESEARCH_RUN_API_KEYS_FILE", "CHAT_BENCH_API_KEYS_FILE");
  if (file) return readFileSync(file, "utf8").trim();
  return readEnv("RESEARCH_RUN_API_KEYS", "CHAT_BENCH_API_KEYS");
}

async function main() {
  await ensureResearchEnergyReady();

  const vllmBase = readEnv("RESEARCH_VLLM_BASE_URL", "VLLM_BASE_URL");
  const vllmKey = readEnv("RESEARCH_VLLM_API_KEY", "VLLM_API_KEY") ?? "vllm-local";
  const eduaiUrl = readEnv("RESEARCH_RUN_URL", "CHAT_BENCH_URL");
  const useDirect = Boolean(vllmBase);

  const modelsRaw =
    readEnv("RESEARCH_ADEQUACY_MODELS") ??
    (useDirect ? "qwen2.5-72b-instruct" : "vllm:qwen2.5-72b-instruct");
  const models = parseModels(modelsRaw);
  if (models.length === 0) {
    console.error("Set RESEARCH_ADEQUACY_MODELS to at least one model.");
    process.exit(1);
  }

  if (!useDirect && !eduaiUrl) {
    console.error("Set RESEARCH_VLLM_BASE_URL (direct) or RESEARCH_RUN_URL (EduAI).");
    process.exit(1);
  }

  let apiKeys = null;
  let headers = null;
  if (!useDirect) {
    const apiKeysJson = loadApiKeysJson();
    const xApiKey = readEnv("RESEARCH_RUN_X_API_KEY", "CHAT_BENCH_X_API_KEY");
    const cookie = readEnv("RESEARCH_RUN_COOKIE", "CHAT_BENCH_COOKIE");
    if (!apiKeysJson) {
      console.error("EduAI mode needs RESEARCH_RUN_API_KEYS_FILE or RESEARCH_RUN_API_KEYS.");
      process.exit(1);
    }
    if (!xApiKey && !cookie) {
      console.error("EduAI mode needs RESEARCH_RUN_X_API_KEY or RESEARCH_RUN_COOKIE.");
      process.exit(1);
    }
    apiKeys = JSON.parse(apiKeysJson);
    headers = { "Content-Type": "application/json" };
    if (xApiKey) headers["x-api-key"] = xApiKey;
    if (cookie) headers.Cookie = cookie;
  }

  const splitFilter = (readEnv("RESEARCH_RUN_SPLIT") ?? "all").toLowerCase();
  const stratumFilter = readEnv("RESEARCH_RUN_STRATUM");
  const tierSensitiveOnly = readEnv("RESEARCH_RUN_TIER_SENSITIVE") === "1";
  const idsFilter = readEnv("RESEARCH_RUN_IDS");
  const limitRaw = readEnv("RESEARCH_RUN_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;
  const outPath = readEnv("RESEARCH_RUN_OUT") ?? DEFAULT_OUT;
  const label = readEnv("RESEARCH_RUN_LABEL") ?? "adequacy-v1";
  const sleepMs = Math.max(0, Number(readEnv("RESEARCH_RUN_SLEEP_MS", "500")) || 0);
  const forceHybridAll = readEnv("RESEARCH_FORCE_HYBRID") === "1";
  const defaultCourseCode = readEnv("RESEARCH_DEFAULT_COURSE_CODE");
  const labelsPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_LABELS;

  let prompts = loadPrompts();
  const tierSensitiveIds = new Set(
    loadJsonl(labelsPath)
      .filter((l) => l.tier_sensitive === true)
      .map((l) => l.prompt_id),
  );

  if (splitFilter !== "all") {
    prompts = prompts.filter((p) => p.split === splitFilter);
  }
  if (stratumFilter) {
    const strata = new Set(
      stratumFilter.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    prompts = prompts.filter((p) => strata.has(String(p.stratum).toLowerCase()));
  }
  if (tierSensitiveOnly) {
    prompts = prompts.filter((p) => tierSensitiveIds.has(p.id));
  }
  if (readEnv("RESEARCH_RUN_HARD_OR_TIER_SENSITIVE") === "1") {
    prompts = prompts.filter(
      (p) => p.stratum === "hard" || tierSensitiveIds.has(p.id),
    );
  }
  if (idsFilter) {
    const ids = new Set(idsFilter.split(",").map((s) => s.trim()).filter(Boolean));
    prompts = prompts.filter((p) => ids.has(p.id));
  }
  if (limit) prompts = prompts.slice(0, limit);

  if (prompts.length === 0) {
    console.error("No prompts matched filters.");
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const runStarted = new Date().toISOString();
  const totalCalls = prompts.length * models.length;
  const measureEnergy = isEnergyMeasurementEnabled();

  console.log("=== model adequacy run ===");
  console.log("label:", label);
  console.log("backend:", useDirect ? `direct-vllm (${vllmBase})` : `eduai (${eduaiUrl})`);
  console.log("models:", models.map((m) => m.model).join(", "));
  console.log("prompts:", prompts.length);
  console.log("tier_sensitive in labels:", tierSensitiveIds.size);
  console.log("output:", outPath);
  console.log("energy:", measureEnergy ? "on" : "off");
  console.log("total calls:", totalCalls);
  console.log("");

  let callIndex = 0;
  let errors = 0;

  for (const row of prompts) {
    for (const { model, lite_name, tier_label } of models) {
      callIndex++;
      const preview =
        row.prompt.length > 55 ? `${row.prompt.slice(0, 52)}…` : row.prompt;
      console.log(
        `[${callIndex}/${totalCalls}] ${row.id} ${tier_label} (${model}) — ${preview}`,
      );

      const hybridFlags = resolveResearchChatFlags(row, { forceHybridAll });
      const timeoutMs = resolveResearchTimeoutMs(readEnv, row);

      const runCall = async () => {
        if (useDirect) {
          return postDirectVllm({
            baseUrl: vllmBase,
            apiKey: vllmKey,
            model: lite_name,
            prompt: row.prompt,
            timeoutMs,
          });
        }
        return postEduaiChat({
          url: eduaiUrl,
          headers,
          apiKeys,
          model,
          prompt: row.prompt,
          courseCode: row.course_code ?? defaultCourseCode ?? undefined,
          forceHybridRag: hybridFlags.forceHybridRag,
          hybridWebTools: hybridFlags.hybridWebTools,
          timeoutMs,
        });
      };

      const result = measureEnergy
        ? await withEnergyMeasurement(runCall, {
            tag: `${row.id}-${lite_name}-${callIndex}`,
          })
        : await runCall();

      if (result.httpStatus >= 400 || result.error) {
        errors++;
        console.log(`  ERROR HTTP ${result.httpStatus}: ${String(result.error).slice(0, 120)}`);
      } else if (!result.responseText) {
        errors++;
        console.log(`  WARN empty response (${result.durationMs} ms)`);
      } else {
        console.log(`  OK ${result.durationMs} ms, ${result.responseText.length} chars`);
      }

      const record = {
        run_label: label,
        run_started: runStarted,
        recorded_at: new Date().toISOString(),
        prompt_id: row.id,
        stratum: row.stratum,
        category: row.category,
        split: row.split,
        rag_context: row.rag_context,
        tools_expected: row.tools_expected,
        course_code: row.course_code,
        prompt: row.prompt,
        tier_label,
        model,
        lite_name,
        backend: result.backend,
        tier_sensitive_label: tierSensitiveIds.has(row.id),
        force_hybrid_rag: hybridFlags.forceHybridRag,
        hybrid_web_tools: hybridFlags.hybridWebTools,
        routed_model: result.routedModel ?? null,
        duration_ms: result.durationMs,
        prompt_tokens: result.promptTokens ?? result.usage?.prompt_tokens ?? null,
        completion_tokens: result.completionTokens ?? result.usage?.completion_tokens ?? null,
        http_status: result.httpStatus,
        finish_reason: result.finishReason,
        response: result.responseText,
        error: result.error,
        vllm_base_url: useDirect ? vllmBase : null,
        ...flattenEnergyFields(result),
      };

      appendFileSync(outPath, `${JSON.stringify(record)}\n`, "utf8");

      if (sleepMs && callIndex < totalCalls) await sleep(sleepMs);
    }
  }

  console.log("");
  console.log("=== done ===");
  console.log("rows:", totalCalls);
  console.log("errors:", errors);
  console.log("output:", outPath);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
