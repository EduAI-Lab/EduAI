#!/usr/bin/env node
/**
 * Step 4b — LLM-judge labeling for both-tier baseline runs.
 *
 * Reads paired 7B/32B responses and writes labels.v1.jsonl with:
 *   min_adequate_tier, tier_sensitive, tier*_adequacy, quality_delta, judge_rationale
 *
 * Required:
 *   RESEARCH_JUDGE_API_KEY
 *
 * Optional:
 *   RESEARCH_LABEL_IN          default docs/research/data/runs/both-tier.v1.jsonl
 *   RESEARCH_LABEL_OUT         default docs/research/data/runs/labels.v1.jsonl
 *   RESEARCH_JUDGE_MODEL       default gpt-4o-mini
 *   RESEARCH_JUDGE_BASE_URL    default https://api.openai.com/v1
 *   RESEARCH_LABEL_LIMIT       max prompts to label
 *   RESEARCH_LABEL_IDS         comma-separated ts-### filter
 *   RESEARCH_LABEL_SLEEP_MS    delay between judge calls (default 300)
 *   RESEARCH_LABEL_DRY_RUN=1   pair + print stats only, no API calls
 *
 * Usage:
 *   cd apps/core && npm run research:label-both-tier
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  isOkRow,
  loadExistingLabelIds,
  loadRunRows,
  pairByPrompt,
} from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, DEFAULT_LABELS_OUT } from "./paths.mjs";

const ADEQUACY = new Set(["adequate", "degraded", "insufficient"]);

const JUDGE_SYSTEM = `You are an expert evaluator for educational AI tutoring responses.

Compare two model answers to the same student prompt. Score each answer independently, then compare them.

Use these adequacy levels:
- "adequate" — correct, helpful, and appropriate for a university tutoring context
- "degraded" — mostly helpful but with minor gaps, imprecision, or weak structure; still usable
- "insufficient" — wrong, off-topic, empty, or too weak to trust for learning

For tool-requiring prompts (web search, fetch page): penalize fabricated citations, made-up URLs, or claims of live lookup without evidence.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "tier1_adequacy": "adequate" | "degraded" | "insufficient",
  "tier3_adequacy": "adequate" | "degraded" | "insufficient" | "not_available",
  "quality_delta": "equivalent" | "7b_better" | "32b_better" | "incomparable",
  "rationale": "2-4 sentences explaining the scores"
}

If tier 3 response is missing or marked unavailable, set tier3_adequacy to "not_available" and quality_delta to "incomparable".`;

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(text, max = 6000) {
  if (!text || text.length <= max) return text ?? "";
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function passesAdequacy(level) {
  return level === "adequate" || level === "degraded";
}

function computeDerived({ tier1Adequacy, tier3Adequacy, tier3Missing }) {
  let minAdequateTier = null;
  if (passesAdequacy(tier1Adequacy)) {
    minAdequateTier = 1;
  } else if (!tier3Missing && passesAdequacy(tier3Adequacy)) {
    minAdequateTier = 3;
  }

  const tierSensitive =
    minAdequateTier === 3 &&
    !passesAdequacy(tier1Adequacy) &&
    !tier3Missing &&
    passesAdequacy(tier3Adequacy);

  return { min_adequate_tier: minAdequateTier, tier_sensitive: tierSensitive };
}

function buildUserPrompt(meta, tier1Row, tier3Row) {
  const tier3Missing = !tier3Row || !isOkRow(tier3Row);
  const tier3Text = tier3Missing
    ? "(not available — request failed or empty response)"
    : tier3Row.response;

  return [
    "## Prompt metadata",
    `prompt_id: ${meta.prompt_id}`,
    `stratum: ${meta.stratum}`,
    `category: ${meta.category}`,
    `rag_context: ${meta.rag_context}`,
    `tools_expected: ${meta.tools_expected}`,
    `course_code: ${meta.course_code ?? "none"}`,
    "",
    "## Student prompt",
    meta.prompt,
    "",
    "## Tier 1 response (7B)",
    truncate(tier1Row?.response ?? ""),
    "",
    "## Tier 3 response (32B)",
    truncate(tier3Text),
    "",
    tier3Missing
      ? "Note: tier 3 response is unavailable; judge tier 1 only and set tier3_adequacy to not_available."
      : "Judge both responses independently, then set quality_delta.",
  ].join("\n");
}

function parseJudgeJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  if (!ADEQUACY.has(parsed.tier1_adequacy)) {
    throw new Error(`Invalid tier1_adequacy: ${parsed.tier1_adequacy}`);
  }
  const t3 = parsed.tier3_adequacy;
  if (t3 !== "not_available" && !ADEQUACY.has(t3)) {
    throw new Error(`Invalid tier3_adequacy: ${t3}`);
  }
  const delta = parsed.quality_delta;
  if (!["equivalent", "7b_better", "32b_better", "incomparable"].includes(delta)) {
    throw new Error(`Invalid quality_delta: ${delta}`);
  }
  if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) {
    throw new Error("Missing rationale");
  }
  return parsed;
}

async function callJudge({ baseUrl, apiKey, model, userPrompt }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Judge HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Judge returned non-JSON body: ${text.slice(0, 200)}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Judge response missing message content");
  }
  return parseJudgeJson(content);
}

async function main() {
  const inPath = readEnv("RESEARCH_LABEL_IN") ?? DEFAULT_BOTH_TIER_IN;
  const outPath = readEnv("RESEARCH_LABEL_OUT") ?? DEFAULT_LABELS_OUT;
  const judgeModel = readEnv("RESEARCH_JUDGE_MODEL") ?? "gpt-4o-mini";
  const judgeBaseUrl = readEnv("RESEARCH_JUDGE_BASE_URL") ?? "https://api.openai.com/v1";
  const judgeApiKey = readEnv("RESEARCH_JUDGE_API_KEY");
  const dryRun = readEnv("RESEARCH_LABEL_DRY_RUN") === "1";
  const limitRaw = readEnv("RESEARCH_LABEL_LIMIT");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;
  const idsFilter = readEnv("RESEARCH_LABEL_IDS");
  const sleepMs = Math.max(0, Number(readEnv("RESEARCH_LABEL_SLEEP_MS", "300")) || 0);
  const labelVersion = readEnv("RESEARCH_LABEL_VERSION") ?? "v1";

  if (!dryRun && !judgeApiKey) {
    console.error("Need RESEARCH_JUDGE_API_KEY (or set RESEARCH_LABEL_DRY_RUN=1).");
    process.exit(1);
  }

  const rows = loadRunRows(inPath, { dedupe: true });
  const pairs = pairByPrompt(rows);
  const existingIds = loadExistingLabelIds(outPath);

  let candidates = [...pairs.entries()]
    .map(([promptId, tiers]) => {
      const t1 = tiers[1];
      const t3 = tiers[3];
      const meta = t1 ?? t3;
      return { promptId, t1, t3, meta };
    })
    .filter(({ meta, t1 }) => meta && t1 && isOkRow(t1))
    .sort((a, b) => a.promptId.localeCompare(b.promptId));

  if (idsFilter) {
    const ids = new Set(idsFilter.split(",").map((s) => s.trim()).filter(Boolean));
    candidates = candidates.filter(({ promptId }) => ids.has(promptId));
  }

  candidates = candidates.filter(({ promptId }) => !existingIds.has(promptId));

  if (limit) {
    candidates = candidates.slice(0, limit);
  }

  const bothOk = candidates.filter(({ t1, t3 }) => isOkRow(t1) && isOkRow(t3)).length;
  const tier3Missing = candidates.length - bothOk;

  console.log("=== both-tier LLM judge ===");
  console.log("input:", inPath);
  console.log("output:", outPath);
  console.log("judge:", judgeModel);
  console.log("dry_run:", dryRun);
  console.log("candidates:", candidates.length, `(both OK: ${bothOk}, tier3 missing: ${tier3Missing})`);
  console.log("skip already labeled:", existingIds.size);
  console.log("");

  if (candidates.length === 0) {
    console.log("Nothing to label.");
    return;
  }

  if (dryRun) {
    for (const { promptId, t1, t3 } of candidates) {
      console.log(
        promptId,
        t1.stratum,
        t1.category,
        `7B:${t1.response.length}ch`,
        isOkRow(t3) ? `32B:${t3.response.length}ch` : "32B:MISSING",
      );
    }
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });

  let labeled = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { promptId, t1, t3, meta } = candidates[i];
    const tier3Missing = !t3 || !isOkRow(t3);
    console.log(
      `[${i + 1}/${candidates.length}] ${promptId} (${meta.stratum}, ${meta.category})` +
        (tier3Missing ? " — tier3 missing" : ""),
    );

    const userPrompt = buildUserPrompt(meta, t1, t3);
    const t0 = performance.now();

    try {
      const judge = await callJudge({
        baseUrl: judgeBaseUrl,
        apiKey: judgeApiKey,
        model: judgeModel,
        userPrompt,
      });

      const tier3Adequacy =
        tier3Missing || judge.tier3_adequacy === "not_available"
          ? "missing"
          : judge.tier3_adequacy;

      const derived = computeDerived({
        tier1Adequacy: judge.tier1_adequacy,
        tier3Adequacy: tier3Missing ? "insufficient" : judge.tier3_adequacy,
        tier3Missing,
      });

      const record = {
        label_version: labelVersion,
        labeled_at: new Date().toISOString(),
        run_label: t1.run_label ?? t3?.run_label ?? null,
        prompt_id: promptId,
        stratum: meta.stratum,
        category: meta.category,
        split: meta.split,
        rag_context: meta.rag_context,
        tools_expected: meta.tools_expected,
        course_code: meta.course_code ?? null,
        prompt: meta.prompt,
        tier1_adequacy: judge.tier1_adequacy,
        tier3_adequacy: tier3Adequacy,
        min_adequate_tier: derived.min_adequate_tier,
        tier_sensitive: derived.tier_sensitive,
        quality_delta: tier3Missing ? "incomparable" : judge.quality_delta,
        judge_rationale: judge.rationale.trim(),
        judge_model: judgeModel,
        tier3_missing: tier3Missing,
        tier1_duration_ms: t1.duration_ms ?? null,
        tier3_duration_ms: tier3Missing ? null : t3.duration_ms ?? null,
        judge_duration_ms: Math.round(performance.now() - t0),
      };

      appendFileSync(outPath, `${JSON.stringify(record)}\n`, "utf8");
      labeled++;
      console.log(
        `  min_tier=${derived.min_adequate_tier ?? "null"} sensitive=${derived.tier_sensitive} ` +
          `(7B:${judge.tier1_adequacy}, 32B:${tier3Adequacy})`,
      );
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.log(`  ERROR: ${message.slice(0, 160)}`);
    }

    if (sleepMs && i + 1 < candidates.length) {
      await sleep(sleepMs);
    }
  }

  console.log("");
  console.log("=== done ===");
  console.log("labeled:", labeled);
  console.log("errors:", errors);
  console.log("output:", outPath);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
