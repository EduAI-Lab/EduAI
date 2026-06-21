#!/usr/bin/env node
/**
 * Summarize both-tier baseline JSONL (no API calls).
 *
 * Usage:
 *   cd apps/core && npm run research:summarize-both-tier
 *
 * Optional:
 *   RESEARCH_LABEL_IN / RESEARCH_RUN_OUT — input JSONL path
 */
import { isOkRow, loadRunRows, pairByPrompt } from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN } from "./paths.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function p(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((q / 100) * s.length) - 1;
  return s[Math.max(0, i)];
}

function main() {
  const inPath =
    readEnv("RESEARCH_LABEL_IN") ?? readEnv("RESEARCH_RUN_OUT") ?? DEFAULT_BOTH_TIER_IN;

  const rows = loadRunRows(inPath, { dedupe: true });
  const pairs = pairByPrompt(rows);

  const byTier = (tier) => rows.filter((r) => r.tier === tier);
  const okRows = (tier) => byTier(tier).filter(isOkRow);

  console.log("=== both-tier run summary ===");
  console.log("input:", inPath);
  console.log("unique rows:", rows.length);
  console.log("prompts:", pairs.size);
  console.log("");

  for (const tier of [1, 3]) {
    const t = byTier(tier);
    const ok = okRows(tier);
    const durs = ok.map((r) => r.duration_ms);
    const lens = ok.map((r) => r.response.length);
    console.log(`Tier ${tier} (${t[0]?.model ?? "?"})`);
    console.log(`  OK: ${ok.length}/${t.length} | errors: ${t.length - ok.length}`);
    if (durs.length) {
      console.log(
        `  latency ms — mean:${Math.round(mean(durs))} median:${Math.round(median(durs))} p95:${Math.round(p(durs, 95))} max:${Math.max(...durs)}`,
      );
      console.log(
        `  chars — mean:${Math.round(mean(lens))} median:${Math.round(median(lens))} p95:${Math.round(p(lens, 95))}`,
      );
    }
    console.log("");
  }

  let bothOk = 0;
  let only7 = 0;
  let only32 = 0;
  let neither = 0;
  const latRatios = [];
  const lenRatios = [];
  const errors32 = [];

  for (const [pid, tiers] of pairs) {
    const t1 = tiers[1];
    const t3 = tiers[3];
    const ok1 = t1 && isOkRow(t1);
    const ok3 = t3 && isOkRow(t3);
    if (ok1 && ok3) {
      bothOk++;
      latRatios.push(t3.duration_ms / t1.duration_ms);
      lenRatios.push(t3.response.length / t1.response.length);
    } else if (ok1) {
      only7++;
      if (t3?.error) errors32.push({ pid, error: t3.error, tools: t3.tools_expected });
    } else if (ok3) only32++;
    else neither++;
  }

  console.log("=== paired ===");
  console.log("both OK:", bothOk);
  console.log("only tier 1:", only7);
  console.log("only tier 3:", only32);
  console.log("neither:", neither);
  if (latRatios.length) {
    console.log("mean 32B/7B latency ratio:", (mean(latRatios)).toFixed(2) + "x");
    console.log("mean 32B/7B char ratio:", (mean(lenRatios)).toFixed(2) + "x");
  }

  if (errors32.length) {
    console.log("");
    console.log("=== tier 3 failures (7B OK) ===");
    for (const e of errors32) {
      console.log(e.pid, e.tools, "-", String(e.error).slice(0, 80));
    }
  }
}

main();
