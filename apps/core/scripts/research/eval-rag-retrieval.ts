/**
 * Track A — retrieval-only RAG eval for issue #501.
 *
 * Runs rag_grounded dev prompts against findRelevantContent (no LLM).
 * Run from apps/core:
 *   npm run research:eval-rag
 *
 * Env:
 *   RESEARCH_RUN_SPLIT       dev (default) | test
 *   RESEARCH_RUN_LIMIT       default 20
 *   RESEARCH_EVAL_RAG_OUT    JSONL output path
 *   RESEARCH_EVAL_RAG_SUMMARY text summary path
 *   DATABASE_URL             required (same DB as dev)
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import prisma from "../../app/lib/prisma.server";
import { findRelevantContent } from "../../app/lib/ai/embedding";
import { PROMPTS_PATH, RUNS_DIR } from "./paths.mjs";

type PromptRow = {
  id: string;
  prompt: string;
  category: string;
  rag_context: string;
  course_code: string | null;
  split: string;
};

function readEnv(name: string, fallback?: string) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function loadPrompts(): PromptRow[] {
  const raw = readFileSync(PROMPTS_PATH, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line) as PromptRow;
    } catch (e) {
      throw new Error(`prompts.v1.jsonl line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function getSimilarityThreshold(): number {
  const raw = process.env.RAG_SIMILARITY_THRESHOLD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0.5;
}

async function resolveCourseId(courseCode: string | null): Promise<string | null> {
  if (!courseCode) return null;
  const course = await prisma.course.findFirst({
    where: { code: courseCode },
    select: { id: true },
  });
  return course?.id ?? null;
}

async function main() {
  const split = (readEnv("RESEARCH_RUN_SPLIT", "dev") ?? "dev").toLowerCase();
  const limit = Math.max(1, Number(readEnv("RESEARCH_RUN_LIMIT", "20")) || 20);
  const outPath =
    readEnv("RESEARCH_EVAL_RAG_OUT") ??
    join(RUNS_DIR, "issue-501", "track-a-rag-retrieval.jsonl");
  const summaryPath =
    readEnv("RESEARCH_EVAL_RAG_SUMMARY") ??
    join(RUNS_DIR, "issue-501", "track-a-rag-retrieval-summary.txt");
  const threshold = getSimilarityThreshold();
  const gitSha = readEnv("RESEARCH_GIT_SHA", "unknown");
  const pipelineLabel = readEnv("RESEARCH_PIPELINE_LABEL", "latest");

  let prompts = loadPrompts().filter(
    (p) => p.split === split && p.category === "rag_grounded",
  );
  if (!prompts.length) {
    console.error(`No rag_grounded prompts for split=${split}.`);
    process.exit(1);
  }
  prompts = prompts.slice(0, limit);

  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });

  const runStarted = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  const courseCache = new Map<string, string | null>();

  console.log("=== Track A: RAG retrieval eval ===");
  console.log("pipeline:", pipelineLabel);
  console.log("git:", gitSha);
  console.log("split:", split);
  console.log("prompts:", prompts.length);
  console.log("threshold:", threshold);
  console.log("hybrid_bm25:", process.env.RAG_HYBRID_BM25 === "1" ? "on" : "off");
  console.log("");

  for (let i = 0; i < prompts.length; i++) {
    const row = prompts[i];
    const preview =
      row.prompt.length > 55 ? `${row.prompt.slice(0, 52)}…` : row.prompt;
    process.stdout.write(`[${i + 1}/${prompts.length}] ${row.id} — ${preview} `);

    let courseId: string | null = null;
    if (row.course_code) {
      if (!courseCache.has(row.course_code)) {
        courseCache.set(row.course_code, await resolveCourseId(row.course_code));
      }
      courseId = courseCache.get(row.course_code) ?? null;
    }

    if (!courseId) {
      console.log("SKIP (no course)");
      rows.push({
        run_started: runStarted,
        pipeline_label: pipelineLabel,
        git_sha: gitSha,
        prompt_id: row.id,
        prompt: row.prompt,
        course_code: row.course_code,
        rag_context: row.rag_context,
        error: "course_not_found",
        chunks_retrieved: 0,
        top1_similarity: null,
        retrieval_latency_ms: 0,
        strong_hit: false,
      });
      continue;
    }

    const t0 = performance.now();
    let chunks: Awaited<ReturnType<typeof findRelevantContent>> = [];
    let error: string | null = null;
    try {
      chunks = await findRelevantContent(row.prompt, courseId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const retrievalLatencyMs = Math.round(performance.now() - t0);
    const top1 = chunks[0]?.similarity ?? null;
    const strongHit = top1 !== null && top1 >= threshold;

    console.log(
      `${error ? "ERROR" : "OK"} chunks=${chunks.length} top1=${top1?.toFixed(3) ?? "—"} ${retrievalLatencyMs}ms`,
    );

    rows.push({
      run_started: runStarted,
      pipeline_label: pipelineLabel,
      git_sha: gitSha,
      prompt_id: row.id,
      prompt: row.prompt,
      course_code: row.course_code,
      course_id: courseId,
      rag_context: row.rag_context,
      chunks_retrieved: chunks.length,
      top1_similarity: top1,
      top1_material: chunks[0]?.materialTitle ?? null,
      retrieval_latency_ms: retrievalLatencyMs,
      similarity_threshold: threshold,
      strong_hit: strongHit,
      error,
    });
  }

  writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

  const ok = rows.filter((r) => !r.error);
  const withChunks = ok.filter((r) => (r.chunks_retrieved as number) > 0);
  const strongHits = ok.filter((r) => r.strong_hit);
  const top1Sims = ok
    .map((r) => r.top1_similarity as number)
    .filter((v) => v != null && Number.isFinite(v));
  const latencies = ok
    .map((r) => r.retrieval_latency_ms as number)
    .sort((a, b) => a - b);

  const summary = [
    "=== Track A: RAG retrieval (findRelevantContent) ===",
    `Generated: ${new Date().toISOString()}`,
    `pipeline: ${pipelineLabel}`,
    `git_sha: ${gitSha}`,
    `split: ${split}`,
    `prompts: ${prompts.length}`,
    `RAG_SIMILARITY_THRESHOLD: ${threshold}`,
    `RAG_HYBRID_BM25: ${process.env.RAG_HYBRID_BM25 === "1" ? "1" : "0"}`,
    "",
    `hit_rate (chunks > 0): ${withChunks.length}/${ok.length}`,
    `strong_hit_rate (top1 >= threshold): ${strongHits.length}/${ok.length}`,
    `mean_top1_similarity: ${top1Sims.length ? (top1Sims.reduce((a, b) => a + b, 0) / top1Sims.length).toFixed(3) : "—"}`,
    "",
    "Retrieval latency (ms):",
    `  p50: ${percentile(latencies, 50)}`,
    `  p95: ${percentile(latencies, 95)}`,
    `  mean: ${latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0}`,
    "",
    "Human relevance: fill `human_relevant` column in JSONL after spot-check.",
    "",
    `output: ${outPath}`,
  ].join("\n");

  writeFileSync(summaryPath, `${summary}\n`, "utf8");
  console.log("\n" + summary);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
