#!/usr/bin/env node
/**
 * Backfill token-based energy from AIInteraction rows and join to research JSONL.
 *
 * Modes:
 *   1) Prisma (on s378 or any host with DATABASE_URL):
 *        DATABASE_URL=... npm run research:backfill-energy
 *   2) Pre-exported JSON from psql:
 *        RESEARCH_INTERACTION_EXPORT=interactions.json npm run research:backfill-energy
 *
 * Joins by userId + exact query text, preferring the candidate closest in time
 * to the run row's own timestamp when more than one row shares that userId +
 * query (e.g. a fixed synthetic userId like "service" reused across many
 * research runs with repeated prompt text -- plain FIFO order previously
 * matched runs to the WRONG, unrelated interaction rows in that case; see
 * backfill-match.test.ts's 2026-08-10 regression case). Query-only matching
 * (no userId) is allowed only when the prompt is unique in the interaction
 * set. Both paths respect RESEARCH_BACKFILL_MATCH_WINDOW_MS (default 60s) as
 * a hard cutoff whenever both sides have timestamps.
 *
 * Env:
 *   RESEARCH_BACKFILL_IN       policy or both-tier JSONL (required)
 *   RESEARCH_BACKFILL_OUT        enriched JSONL (default: <in>-with-energy.jsonl)
 *   RESEARCH_BACKFILL_SINCE      ISO timestamp lower bound (optional)
 *   RESEARCH_BACKFILL_UNTIL      ISO timestamp upper bound (optional)
 *   RESEARCH_BACKFILL_MATCH_WINDOW_MS  match time window, both paths (default 60000)
 */
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import {
  indexInteractions,
  takeMatch,
  toMs,
} from "./backfill-match.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

async function loadJsonl(path) {
  const lines = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed));
  }
  return lines;
}

function loadExport(path) {
  const raw = readFileSync(path, "utf8");
  const json = JSON.parse(raw);
  return Array.isArray(json) ? json : json.rows ?? [];
}

async function loadInteractionsFromDb({ since, until }) {
  const prisma = new PrismaClient();
  try {
    const where = {};
    if (since || until) {
      where.createdAt = {};
      if (since) where.createdAt.gte = new Date(since);
      if (until) where.createdAt.lte = new Date(until);
    }
    const rows = await prisma.aIInteraction.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        modelUsed: true,
        query: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        energyJoules: true,
        energySource: true,
        carbonGramsCO2: true,
        durationMs: true,
        routedByAuto: true,
        routerChosenTier: true,
      },
    });
    return rows;
  } finally {
    await prisma.$disconnect();
  }
}

function summarize(rows) {
  const matched = rows.filter((r) => r._interaction_match).length;
  const withEnergy = rows.filter((r) => r.energy_joules != null).length;
  const withTokens = rows.filter(
    (r) =>
      (r.prompt_tokens != null && r.completion_tokens != null) ||
      r.total_tokens != null,
  ).length;
  return { total: rows.length, matched, withEnergy, withTokens };
}

async function main() {
  const inPath = readEnv("RESEARCH_BACKFILL_IN");
  const exportPath = readEnv("RESEARCH_INTERACTION_EXPORT");
  const since = readEnv("RESEARCH_BACKFILL_SINCE");
  const until = readEnv("RESEARCH_BACKFILL_UNTIL");
  const windowMs = Number(readEnv("RESEARCH_BACKFILL_MATCH_WINDOW_MS") ?? "60000");

  if (!inPath) {
    console.error("Set RESEARCH_BACKFILL_IN to a policy or both-tier JSONL file.");
    process.exit(1);
  }

  const outPath =
    readEnv("RESEARCH_BACKFILL_OUT") ??
    join(dirname(inPath), `${basename(inPath, ".jsonl")}-with-energy.jsonl`);

  const runRows = await loadJsonl(inPath);
  let interactions;
  if (exportPath) {
    interactions = loadExport(exportPath);
    console.log(`Loaded ${interactions.length} interactions from export`);
  } else if (process.env.DATABASE_URL) {
    interactions = await loadInteractionsFromDb({ since, until });
    console.log(`Loaded ${interactions.length} interactions from database`);
  } else {
    console.error("Set DATABASE_URL or RESEARCH_INTERACTION_EXPORT.");
    process.exit(1);
  }

  const index = indexInteractions(interactions);
  const enriched = [];
  let skippedMissingUserId = 0;
  let rowsWithoutUsableTimestamp = 0;

  for (const row of runRows) {
    const promptText = row.prompt ?? row.query ?? "";
    const userId = row.userId ?? row.user_id ?? null;
    const runTs = row.timestamp ?? row.createdAt ?? row.created_at ?? null;
    // A userId present but no PARSEABLE runTs silently reverts takeMatch()'s
    // userId::query path to plain FIFO (see backfill-match.mjs) -- which is
    // exactly the failure mode this whole matching scheme was hardened
    // against (2026-08-10: a run whose export used a field name not covered
    // by the fallback chain above got silently FIFO-matched to an unrelated
    // earlier run's rows, caught only by a human noticing a suspiciously
    // uniform timestamp offset). Uses toMs() (the exact same parser
    // takeMatch() uses internally) rather than a plain null check, so a
    // present-but-unparseable value (e.g. "n/a", a non-ISO string) is also
    // counted -- not just a genuinely missing field. Counted and surfaced
    // below so a future field-name mismatch or malformed timestamp shows up
    // in the summary instead of looking like a clean, fully-verified match.
    if (userId && toMs(runTs) == null) rowsWithoutUsableTimestamp += 1;
    const match = takeMatch(index, promptText, userId, {
      runTimestamp: runTs,
      windowMs: Number.isFinite(windowMs) ? windowMs : 60_000,
    });
    if (!userId && !match) {
      skippedMissingUserId += 1;
    }
    enriched.push({
      ...row,
      _interaction_match: Boolean(match),
      interaction_id: match?.id ?? null,
      interaction_user_id: match?.userId ?? null,
      interaction_created_at: match?.createdAt ?? null,
      prompt_tokens: match?.promptTokens ?? null,
      completion_tokens: match?.completionTokens ?? null,
      total_tokens: match?.totalTokens ?? null,
      energy_joules: match?.energyJoules ?? null,
      energy_source: match?.energySource ?? null,
      carbon_grams_co2: match?.carbonGramsCO2 ?? null,
      db_duration_ms: match?.durationMs ?? null,
      db_model_used: match?.modelUsed ?? null,
      db_routed_by_auto: match?.routedByAuto ?? null,
      db_router_chosen_tier: match?.routerChosenTier ?? null,
    });
  }

  const stats = summarize(enriched);
  writeFileSync(
    outPath,
    enriched.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );

  const summaryPath = outPath.replace(/\.jsonl$/, "-summary.txt");
  const summary = [
    "=== interaction energy backfill ===",
    `generated: ${new Date().toISOString()}`,
    `input: ${inPath}`,
    `output: ${outPath}`,
    `rows: ${stats.total}`,
    `matched to AIInteraction: ${stats.matched}`,
    `with energy_joules: ${stats.withEnergy}`,
    `with token counts: ${stats.withTokens}`,
    `run rows without userId (query-only path): ${skippedMissingUserId}`,
    `run rows with userId but no usable timestamp (FIFO fallback, NOT time-verified): ${rowsWithoutUsableTimestamp}`,
    "",
    "Note: energy_joules from DB is ESTIMATED_FROM_TOKENS unless sidecar was active.",
    "Matching prefers userId::query; query-only requires a unique prompt (+ optional time window).",
  ].join("\n");
  writeFileSync(summaryPath, `${summary}\n`, "utf8");

  console.log(summary);
  if (rowsWithoutUsableTimestamp > 0) {
    console.warn(
      `WARNING: ${rowsWithoutUsableTimestamp} row(s) had a userId but no usable timestamp field ` +
        "(checked row.timestamp/row.createdAt/row.created_at) -- those matches fell back to unverified " +
        "FIFO and may be wrong if the interaction pool has repeated prompt text across multiple runs. " +
        "Check your run export's field names.",
    );
  }
  if (stats.matched === 0) {
    console.warn("WARNING: no rows matched — check RESEARCH_BACKFILL_SINCE/UNTIL or export window.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
