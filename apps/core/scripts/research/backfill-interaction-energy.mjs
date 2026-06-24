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
 * Joins by exact query text match to prompt field in policy/both-tier JSONL.
 *
 * Env:
 *   RESEARCH_BACKFILL_IN       policy or both-tier JSONL (required)
 *   RESEARCH_BACKFILL_OUT        enriched JSONL (default: <in>-with-energy.jsonl)
 *   RESEARCH_BACKFILL_SINCE      ISO timestamp lower bound (optional)
 *   RESEARCH_BACKFILL_UNTIL      ISO timestamp upper bound (optional)
 */
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";

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
        createdAt: true,
        modelUsed: true,
        query: true,
        promptTokens: true,
        completionTokens: true,
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

function indexInteractions(rows) {
  /** query text -> list of interactions (FIFO for duplicate prompts) */
  const map = new Map();
  for (const row of rows) {
    const key = (row.query ?? "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function takeMatch(index, promptText) {
  const key = (promptText ?? "").trim();
  const list = index.get(key);
  if (!list || list.length === 0) return null;
  return list.shift();
}

function summarize(rows) {
  const matched = rows.filter((r) => r._interaction_match).length;
  const withEnergy = rows.filter((r) => r.energy_joules != null).length;
  const withTokens = rows.filter(
    (r) => r.prompt_tokens != null && r.completion_tokens != null,
  ).length;
  return { total: rows.length, matched, withEnergy, withTokens };
}

async function main() {
  const inPath = readEnv("RESEARCH_BACKFILL_IN");
  const exportPath = readEnv("RESEARCH_INTERACTION_EXPORT");
  const since = readEnv("RESEARCH_BACKFILL_SINCE");
  const until = readEnv("RESEARCH_BACKFILL_UNTIL");

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

  for (const row of runRows) {
    const promptText = row.prompt ?? row.query ?? "";
    const match = takeMatch(index, promptText);
    enriched.push({
      ...row,
      _interaction_match: Boolean(match),
      interaction_id: match?.id ?? null,
      interaction_created_at: match?.createdAt ?? null,
      prompt_tokens: match?.promptTokens ?? null,
      completion_tokens: match?.completionTokens ?? null,
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
    "",
    "Note: energy_joules from DB is ESTIMATED_FROM_TOKENS unless sidecar was active.",
  ].join("\n");
  writeFileSync(summaryPath, `${summary}\n`, "utf8");

  console.log(summary);
  if (stats.matched === 0) {
    console.warn("WARNING: no rows matched — check RESEARCH_BACKFILL_SINCE/UNTIL or export window.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
