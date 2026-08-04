#!/usr/bin/env node
// Stage 4 standalone-adequacy judging (PREREG_v3.md §6.1a).
//
// Judges every row in generation-results.jsonl (800 rows = 200 prompts x
// 4 ladder tiers) with the primary judge (llama-3.3-70b-instruct-awq on
// cmps01), 3 replicates per row, majority vote, per the §6.3 protocol
// (randomized presentation N/A here since this is single-answer, not
// pairwise -- §6.1a is explicit that no comparison to another model's
// answer is made).
//
// Output: one JSON object per input row, appended with a `standaloneAdequacy`
// block: { replicates: ["YES"|"NO", ...], votes: {yes, no}, verdict: "adequate"|"inadequate", tie: bool }
// Ties are impossible at 3 replicates (no even split), but the field is
// still recorded for auditability per §6.3's tie-handling note (that note
// is about the pairwise minimum-adequate-tier label; standalone adequacy
// with 3 replicates always has a majority, so this is just a integrity check).

import fs from "node:fs";
import readline from "node:readline";

const JUDGE_BASE_URL = process.env.JUDGE_BASE_URL || "http://cmps01.ok.ubc.ca:8001/v1";
const JUDGE_API_KEY = process.env.JUDGE_API_KEY || "vllm-local";
const JUDGE_MODEL = process.env.JUDGE_MODEL || "llama-3.3-70b-instruct-awq";
const REPLICATES = 3;
const CONCURRENCY = Number(process.env.JUDGE_CONCURRENCY || 4);

const INPUT_RESULTS = process.argv[2] || "./generation-results.jsonl";
const INPUT_PROMPTS = process.argv[3] || "./prompts.v3.jsonl";
const OUTPUT_PATH = process.argv[4] || "./standalone-adequacy-results.jsonl";
const RAW_OUTPUT_PATH = process.argv[5] || "./standalone-adequacy-raw.jsonl";

const RUBRIC = `You are judging a single answer given by an AI tutor to a student's question. Judge ONLY this answer on its own merits — you are not comparing it to any other answer.

Standard (frozen rubric strict-v3, §6.1a of the study pre-registration):
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

async function callJudge(prompt, answer, attempt) {
  const res = await fetch(`${JUDGE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JUDGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: RUBRIC },
        { role: "user", content: buildUserMessage(prompt, answer) },
      ],
      temperature: 0.3,
      max_tokens: 16,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`judge HTTP ${res.status} (attempt ${attempt}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const verdict = parseVerdict(text);
  return { text, verdict };
}

async function judgeRowWithRetries(prompt, answer, replicateIndex) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text, verdict } = await callJudge(prompt, answer, attempt);
      if (verdict === "YES" || verdict === "NO") {
        return { replicateIndex, verdict, raw: text };
      }
      lastErr = new Error(`unparseable verdict: ${JSON.stringify(text)}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastErr;
}

async function judgeRow(row, promptText) {
  const answer = row.error ? null : row.answer;
  if (row.status !== 200 || !answer) {
    return {
      ...row,
      standaloneAdequacy: {
        replicates: [],
        votes: { yes: 0, no: 0 },
        verdict: "inadequate",
        tie: false,
        note: "generation failed or empty answer; auto-inadequate, not sent to judge",
      },
    };
  }

  const replicateResults = await Promise.all(
    Array.from({ length: REPLICATES }, (_, i) => judgeRowWithRetries(promptText, answer, i))
  );
  const replicates = replicateResults.map((r) => r.verdict);
  const votes = { yes: replicates.filter((v) => v === "YES").length, no: replicates.filter((v) => v === "NO").length };
  const tie = votes.yes === votes.no;
  const verdict = tie ? "inadequate" /* unreachable at 3 replicates; conservative fallback */ : votes.yes > votes.no ? "adequate" : "inadequate";

  return {
    row: { ...row, standaloneAdequacy: { replicates, votes, verdict, tie } },
    raw: replicateResults.map((r, i) => ({
      promptId: row.promptId,
      tier: row.tier,
      replicateIndex: i,
      verdict: r.verdict,
      rawText: r.raw,
    })),
  };
}

async function main() {
  console.error(`Loading ${INPUT_RESULTS} and ${INPUT_PROMPTS} ...`);
  const results = await readJsonl(INPUT_RESULTS);
  const prompts = await readJsonl(INPUT_PROMPTS);
  const promptById = new Map(prompts.map((p) => [p.id, p.prompt]));

  console.error(`Judging ${results.length} rows with ${REPLICATES} replicates each via ${JUDGE_MODEL} (concurrency=${CONCURRENCY}) ...`);

  const outStream = fs.createWriteStream(OUTPUT_PATH, { flags: "w" });
  const rawStream = fs.createWriteStream(RAW_OUTPUT_PATH, { flags: "w" });

  let completed = 0;
  let idx = 0;
  const startedAt = Date.now();

  async function worker() {
    while (idx < results.length) {
      const myIdx = idx++;
      const row = results[myIdx];
      const promptText = promptById.get(row.promptId);
      if (!promptText) {
        console.error(`WARNING: no prompt text for ${row.promptId}, skipping`);
        completed++;
        continue;
      }
      try {
        const out = await judgeRow(row, promptText);
        if (out.row) {
          outStream.write(JSON.stringify(out.row) + "\n");
          for (const r of out.raw) rawStream.write(JSON.stringify(r) + "\n");
        } else {
          outStream.write(JSON.stringify(out) + "\n");
        }
      } catch (err) {
        console.error(`ERROR judging ${row.promptId}/${row.tier}: ${err.message}`);
        outStream.write(
          JSON.stringify({
            ...row,
            standaloneAdequacy: { replicates: [], votes: { yes: 0, no: 0 }, verdict: "error", tie: false, error: String(err.message) },
          }) + "\n"
        );
      }
      completed++;
      if (completed % 25 === 0 || completed === results.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.error(`  ${completed}/${results.length} rows judged (${elapsed}s elapsed)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  outStream.end();
  rawStream.end();
  console.error(`Done. Wrote ${OUTPUT_PATH} and ${RAW_OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
