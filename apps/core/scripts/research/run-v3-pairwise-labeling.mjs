#!/usr/bin/env node
// Stage 5 sequential calibration labeling (PREREG_v3.md §3.4, §6.1, rubric-strict-v3.md).
//
// Labels calibration-candidate prompts with the pairwise "minimum adequate
// tier" label: for each prompt, judge the small-tier (2B) answer's standalone
// adequacy first; only escalate to checking the large-tier (9B) answer if
// the small-tier answer is inadequate. 3 replicates per sub-judgment,
// majority vote, ties escalate (conservative direction per §6.3).
//
// Batches of 20 candidates at a time (§3.4 step 2), stopping once 20 tier-3
// (escalation) items are secured (§3.4 step 3) or all 60 candidates are
// exhausted.
//
// Per rubric-strict-v3.md's tier-number clarification: "tier-3" = escalation
// to the large tier (9B), which is ladder-position 3. "tier-1" = small tier
// (2B) adequate, no escalation needed.

import fs from "node:fs";
import readline from "node:readline";

const JUDGE_BASE_URL = process.env.JUDGE_BASE_URL || "http://cmps01.ok.ubc.ca:8001/v1";
const JUDGE_API_KEY = process.env.JUDGE_API_KEY || "vllm-local";
const JUDGE_MODEL = process.env.JUDGE_MODEL || "llama-3.3-70b-instruct-awq";
const REPLICATES = 3;
const CONCURRENCY = Number(process.env.JUDGE_CONCURRENCY || 4);
const BATCH_SIZE = 20;
const ESCALATION_TARGET = 20;

const GEN_RESULTS_PATH = process.argv[2] || "./generation-results.jsonl";
const PROMPTS_PATH = process.argv[3] || "./prompts.v3.jsonl";
const CANDIDATES_PATH = process.argv[4] || "./calibration-candidates.json";
const OUTPUT_PATH = process.argv[5] || "./pairwise-labels.jsonl";
const RAW_OUTPUT_PATH = process.argv[6] || "./pairwise-labels-raw.jsonl";

const ADEQUACY_RUBRIC = `You are judging a single answer given by an AI tutor to a student's question. Judge ONLY this answer on its own merits — you are not comparing it to any other answer.

Standard (frozen rubric strict-v3):
A single answer is ADEQUATE if it is factually correct, responsive to what was asked, and sufficient for a student to act on without needing a further correction.
A single answer is INADEQUATE if it contains a factual error, omits a step required to reach the answer, or answers a different question than the one asked.

Respond in EXACTLY this format, nothing else:
VERDICT: YES
or
VERDICT: NO

YES means adequate. NO means inadequate.`;

function buildUserMessage(prompt, answer) {
  return `Student question:\n${prompt}\n\nAI tutor's answer:\n${answer}\n\nIs this answer adequate? Respond with only "VERDICT: YES" or "VERDICT: NO".`;
}

async function readJsonl(path) {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

function parseVerdict(text) {
  const m = /VERDICT:\s*(YES|NO)/i.exec(text || "");
  if (!m) return null;
  return m[1].toUpperCase();
}

async function callJudge(prompt, answer) {
  const res = await fetch(`${JUDGE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JUDGE_API_KEY}` },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: ADEQUACY_RUBRIC },
        { role: "user", content: buildUserMessage(prompt, answer) },
      ],
      temperature: 0.3,
      max_tokens: 16,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`judge HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, verdict: parseVerdict(text) };
}

async function callJudgeWithRetries(prompt, answer) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text, verdict } = await callJudge(prompt, answer);
      if (verdict === "YES" || verdict === "NO") return { verdict, raw: text };
      lastErr = new Error(`unparseable verdict: ${JSON.stringify(text)}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastErr;
}

// Randomized presentation order per §6.3: for a single-answer standalone
// judgment there's no left/right pair to randomize within one call, but the
// *order in which the two sub-judgments run* (small-tier check, then
// large-tier check only if needed) is fixed by the §6.1 decision procedure
// itself, not by presentation order — so nothing to randomize there. What
// IS randomized is which replicate call happens against which answer batch
// position, handled implicitly by concurrent scheduling below.

// 3 replicates, majority vote, ties -> inadequate (escalate), per §6.3.
async function standaloneAdequacy3x(promptText, answer) {
  const results = await Promise.all(Array.from({ length: REPLICATES }, () => callJudgeWithRetries(promptText, answer)));
  const replicates = results.map((r) => r.verdict);
  const votes = { yes: replicates.filter((v) => v === "YES").length, no: replicates.filter((v) => v === "NO").length };
  const tie = votes.yes === votes.no;
  const adequate = tie ? false : votes.yes > votes.no;
  return { replicates, votes, tie, adequate, raw: results.map((r) => r.raw) };
}

async function labelOnePrompt(promptId, promptText, smallAnswer, largeAnswer) {
  const smallJudgment = await standaloneAdequacy3x(promptText, smallAnswer);

  if (smallJudgment.adequate) {
    return {
      promptId,
      label: "small",
      tierNumeral: "tier-1",
      escalated: false,
      bothInadequate: false,
      smallJudgment,
      largeJudgment: null,
    };
  }

  const largeJudgment = await standaloneAdequacy3x(promptText, largeAnswer);
  const bothInadequate = !largeJudgment.adequate;

  return {
    promptId,
    label: "large",
    tierNumeral: "tier-3",
    escalated: true,
    bothInadequate,
    smallJudgment,
    largeJudgment,
  };
}

async function main() {
  console.error("Loading inputs...");
  const genResults = await readJsonl(GEN_RESULTS_PATH);
  const prompts = await readJsonl(PROMPTS_PATH);
  const candidateIds = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8"));

  const promptById = new Map(prompts.map((p) => [p.id, p.prompt]));
  const answersByPromptTier = new Map();
  for (const row of genResults) {
    answersByPromptTier.set(`${row.promptId}::${row.tier}`, row.answer);
  }

  // Pre-existing progress: resume if output file already has labels.
  const alreadyLabeled = new Map();
  if (fs.existsSync(OUTPUT_PATH)) {
    const prior = await readJsonl(OUTPUT_PATH);
    for (const row of prior) alreadyLabeled.set(row.promptId, row);
    console.error(`Resuming: ${alreadyLabeled.size} prompts already labeled from a prior run.`);
  }

  const outStream = fs.createWriteStream(OUTPUT_PATH, { flags: "a" });
  const rawStream = fs.createWriteStream(RAW_OUTPUT_PATH, { flags: "a" });

  let escalationCount = [...alreadyLabeled.values()].filter((r) => r.escalated).length;
  let labeledCount = alreadyLabeled.size;

  console.error(`Starting: ${escalationCount} escalations secured so far, target ${ESCALATION_TARGET}.`);

  const remaining = candidateIds.filter((id) => !alreadyLabeled.has(id));

  for (let batchStart = 0; batchStart < remaining.length; batchStart += BATCH_SIZE) {
    if (escalationCount >= ESCALATION_TARGET) {
      console.error(`Escalation target reached (${escalationCount}/${ESCALATION_TARGET}). Stopping before further batches.`);
      break;
    }

    const batch = remaining.slice(batchStart, batchStart + BATCH_SIZE);
    console.error(`\n=== Batch: candidates ${batchStart + 1}-${batchStart + batch.length} of ${remaining.length} remaining (escalations so far: ${escalationCount}/${ESCALATION_TARGET}) ===`);

    let idx = 0;
    const batchResults = new Array(batch.length);

    async function worker() {
      while (idx < batch.length) {
        const myIdx = idx++;
        const promptId = batch[myIdx];
        const promptText = promptById.get(promptId);
        const smallAnswer = answersByPromptTier.get(`${promptId}::2b`);
        const largeAnswer = answersByPromptTier.get(`${promptId}::9b`);

        if (!promptText || !smallAnswer || !largeAnswer) {
          console.error(`  SKIP ${promptId}: missing prompt or answer data`);
          continue;
        }

        try {
          const result = await labelOnePrompt(promptId, promptText, smallAnswer, largeAnswer);
          batchResults[myIdx] = result;
          console.error(`  ${promptId}: ${result.label} (${result.tierNumeral})${result.bothInadequate ? " [bothInadequate]" : ""}`);
        } catch (err) {
          console.error(`  ERROR ${promptId}: ${err.message}`);
          batchResults[myIdx] = { promptId, label: "error", error: String(err.message) };
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    for (const result of batchResults) {
      if (!result) continue;
      outStream.write(JSON.stringify(result) + "\n");
      rawStream.write(JSON.stringify({ promptId: result.promptId, smallJudgment: result.smallJudgment, largeJudgment: result.largeJudgment }) + "\n");
      labeledCount++;
      if (result.escalated) escalationCount++;
    }

    console.error(`Batch done. Total labeled: ${labeledCount}, escalations: ${escalationCount}/${ESCALATION_TARGET}`);
  }

  outStream.end();
  rawStream.end();

  console.error(`\n=== FINAL: ${labeledCount} labeled, ${escalationCount} escalations (target ${ESCALATION_TARGET}) ===`);
  if (escalationCount < ESCALATION_TARGET) {
    console.error(`WARNING: escalation target NOT met after exhausting available candidates. Per §3.4 contingency: if yield < 15% after 40 labeled, author harder candidates (curriculum-defined, not adversarial). This script does not author new prompts.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
