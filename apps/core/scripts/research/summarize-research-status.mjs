#!/usr/bin/env node
/**
 * Generate a markdown research status report (advisor memo skeleton).
 *
 * Reads policy runs, labels, and optional strict labels from RESEARCH_RUNS_DIR.
 * No API calls — safe to run on laptop after scp.
 *
 * Env:
 *   RESEARCH_RUNS_DIR
 *   RESEARCH_STATUS_OUT     default RUNS_DIR/research-status-YYYY-MM-DD.md
 *   RESEARCH_POLICY_P0_DEV    P0 dev run (default policy-runs-p0-dev.jsonl if exists)
 *   RESEARCH_POLICY_P1_DEV    P1 dev run (default policy-runs-p1-dev-v2.jsonl if exists)
 *   RESEARCH_POLICY_P2_DEV    P2 dev run (hybrid; legacy P3a rows OK)
 *   RESEARCH_POLICY_P3_DEV    P3 dev run (LLM classifier; legacy P3b rows OK)
 *   RESEARCH_POLICY_P1_TEST   P1 test run (default policy-runs-p1-test-v2.jsonl if exists)
 *   RESEARCH_POLICY_P3_TEST   P3 test run (default policy-runs-p3-test-v2.jsonl if exists)
 *   RESEARCH_LABEL_OUT      labels (default labels.v1.jsonl)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_LABELS_OUT,
  RUNS_DIR,
  resolveRunsFile,
} from "./paths.mjs";
import { rowMatchesPolicy } from "./policy-ids.mjs";

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path) {
  if (!existsSync(path)) return null;
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

function pickPath(explicit, ...candidates) {
  if (explicit) return explicit;
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

function policySummary(rows, pol) {
  const ok = rows.filter((r) => rowMatchesPolicy(r, pol) && !r.error && r.response);
  if (!ok.length) return null;
  const durs = ok.map((r) => r.duration_ms);
  const out = {
    n: ok.length,
    mean_latency_ms: Math.round(mean(durs)),
    p50_latency_ms: Math.round(percentile(durs, 0.5)),
    p95_latency_ms: Math.round(percentile(durs, 0.95)),
    errors: rows.filter((r) => rowMatchesPolicy(r, pol) && (r.error || r.http_status >= 400)).length,
  };
  const tiers = { 1: 0, 2: 0, 3: 0, null: 0 };
  for (const r of ok) {
    const t = r.routing_tier ?? (pol === "P0" ? 3 : null);
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  out.routing_tier = tiers;
  const versions = {};
  for (const r of ok) {
    const v = r.router_version ?? (pol === "P0" ? "n/a" : "?");
    versions[v] = (versions[v] ?? 0) + 1;
  }
  if (pol !== "P0") out.router_version = versions;
  return out;
}

function rowsForPolicy(rows, pol) {
  if (!rows?.length) return rows;
  return rows.some((r) => r.policy) ? rows.filter((r) => rowMatchesPolicy(r, pol)) : rows;
}

function summarizeFile(rows, pol) {
  if (!rows?.length) return null;
  const scoped = rowsForPolicy(rows, pol);
  const ok = scoped.filter((r) => !r.error && r.response);
  if (!ok.length) return null;
  const durs = ok.map((r) => r.duration_ms);
  const tiers = { 1: 0, 2: 0, 3: 0, null: 0 };
  for (const r of ok) {
    const t = r.routing_tier ?? (pol === "P0" ? 3 : 1);
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  const versions = {};
  for (const r of ok) {
    if (r.router_version) versions[r.router_version] = (versions[r.router_version] ?? 0) + 1;
  }
  return {
    n: ok.length,
    mean_latency_ms: Math.round(mean(durs)),
    p50_latency_ms: Math.round(percentile(durs, 0.5)),
    p95_latency_ms: Math.round(percentile(durs, 0.95)),
    routing_tier: tiers,
    router_version: Object.keys(versions).length ? versions : undefined,
  };
}

function oracleGap(rows, labels, label, policyFilter) {
  if (!rows?.length || !labels?.length) return null;
  const scoped = policyFilter ? rowsForPolicy(rows, policyFilter) : rows;
  const labelById = new Map(labels.map((l) => [l.prompt_id, l]));
  let matched = 0;
  let correct = 0;
  let underRoute = 0;
  let overRoute = 0;

  for (const row of scoped.filter((r) => !r.error)) {
    const labelRow = labelById.get(row.prompt_id);
    if (!labelRow || labelRow.min_adequate_tier == null) continue;
    matched++;
    const chosen = row.routing_tier ?? 1;
    const oracle = labelRow.min_adequate_tier;
    if (chosen === oracle) correct++;
    else if (chosen < oracle) underRoute++;
    else overRoute++;
  }

  if (!matched) return null;
  return {
    label,
    matched,
    correct,
    correct_pct: ((100 * correct) / matched).toFixed(1),
    underRoute,
    overRoute,
  };
}

function labelStats(labels) {
  if (!labels?.length) return null;
  return {
    rows: labels.length,
    tier_sensitive: labels.filter((l) => l.tier_sensitive).length,
    min_adequate_tier_3: labels.filter((l) => l.min_adequate_tier === 3).length,
    min_adequate_tier_1: labels.filter((l) => l.min_adequate_tier === 1).length,
  };
}

function pctDelta(base, val) {
  if (!base || val == null) return null;
  return (((base - val) / base) * 100).toFixed(1);
}

function main() {
  const runsDir = readEnv("RESEARCH_RUNS_DIR") ?? RUNS_DIR;
  const date = new Date().toISOString().slice(0, 10);
  const outPath =
    readEnv("RESEARCH_STATUS_OUT") ??
    join(runsDir, "status", `research-status-${date}.md`);

  const labelsPath =
    readEnv("RESEARCH_LABEL_OUT") ??
    (existsSync(resolveRunsFile("labels-strict.v1.jsonl"))
      ? resolveRunsFile("labels-strict.v1.jsonl")
      : DEFAULT_LABELS_OUT);
  const p0DevPath = pickPath(
    readEnv("RESEARCH_POLICY_P0_DEV"),
    resolveRunsFile("policy-runs-p0-dev.jsonl"),
    "/tmp/policy-runs-p0-dev.jsonl",
  );
  const routingDevPath = resolveRunsFile("policy-runs-routing-dev-v1.jsonl");
  const p1DevPath = pickPath(
    readEnv("RESEARCH_POLICY_P1_DEV"),
    routingDevPath,
    resolveRunsFile("policy-runs-p1-dev-v2.jsonl"),
    resolveRunsFile("policy-runs-p1-dev.jsonl"),
    "/tmp/policy-runs-p1-dev-v2.jsonl",
  );
  const p3DevPath = pickPath(
    readEnv("RESEARCH_POLICY_P3_DEV") ?? readEnv("RESEARCH_POLICY_P3B_DEV"),
    routingDevPath,
    resolveRunsFile("policy-runs-p3-dev-v2.jsonl"),
    resolveRunsFile("policy-runs-p3b-dev-v2.jsonl"),
    "/tmp/policy-runs-p3-dev-v2.jsonl",
    "/tmp/policy-runs-p3b-dev-v2.jsonl",
  );
  const p2DevPath = pickPath(
    readEnv("RESEARCH_POLICY_P2_DEV") ?? readEnv("RESEARCH_POLICY_P3A_DEV"),
    routingDevPath,
  );
  const p1TestPath = pickPath(
    readEnv("RESEARCH_POLICY_P1_TEST"),
    resolveRunsFile("policy-runs-p1-test-v2.jsonl"),
    "/tmp/policy-runs-p1-test-v2.jsonl",
  );
  const p3TestPath = pickPath(
    readEnv("RESEARCH_POLICY_P3_TEST") ?? readEnv("RESEARCH_POLICY_P3B_TEST"),
    resolveRunsFile("policy-runs-p3-test-v2.jsonl"),
    resolveRunsFile("policy-runs-p3b-test-v2.jsonl"),
    "/tmp/policy-runs-p3-test-v2.jsonl",
    "/tmp/policy-runs-p3b-test-v2.jsonl",
  );

  const labels = loadJsonl(labelsPath);
  const p0Dev = loadJsonl(p0DevPath);
  const p1Dev = loadJsonl(p1DevPath);
  const p2Dev = p2DevPath && existsSync(p2DevPath) ? loadJsonl(p2DevPath) : null;
  const p3Dev = loadJsonl(p3DevPath);
  const p1Test = loadJsonl(p1TestPath);
  const p3Test = loadJsonl(p3TestPath);

  const lines = [
    "# EduAI URA — Research status",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "See also: `URA/docs/research/findings/RESULTS.md` for interpretation.",
    "",
    "## Artifacts",
    "",
    "| File | Status |",
    "|------|--------|",
    `| Labels \`${labelsPath}\` | ${labels ? `${labels.length} rows` : "missing"} |`,
    `| P0 dev \`${p0DevPath}\` | ${p0Dev ? `${p0Dev.length} rows` : "missing"} |`,
    `| P1 dev \`${p1DevPath}\` | ${p1Dev ? `${p1Dev.length} rows` : "missing"} |`,
    `| P2 dev \`${p2DevPath}\` | ${p2Dev ? `${p2Dev.length} rows` : "missing"} |`,
    `| P3 dev \`${p3DevPath}\` | ${p3Dev ? `${p3Dev.length} rows` : "missing"} |`,
    `| P1 test \`${p1TestPath}\` | ${p1Test ? `${p1Test.length} rows` : "missing"} |`,
    `| P3 test \`${p3TestPath}\` | ${p3Test ? `${p3Test.length} rows` : "missing"} |`,
    "",
  ];

  const ls = labelStats(labels);
  if (ls) {
    lines.push("## Label corpus", "");
    lines.push(`- Rows: ${ls.rows}`);
    lines.push(`- Tier-sensitive: ${ls.tier_sensitive}`);
    lines.push(`- \`min_adequate_tier=1\`: ${ls.min_adequate_tier_1}`);
    lines.push(`- \`min_adequate_tier=3\`: ${ls.min_adequate_tier_3}`);
    if (ls.tier_sensitive === 0 && ls.min_adequate_tier_3 === 0) {
      lines.push("");
      lines.push(
        "> **Caveat:** All dev labels are tier 1 — oracle gap only measures over-routing (energy waste), not quality gains from 32B.",
      );
    }
    lines.push("");
  }

  const p0s = summarizeFile(p0Dev, "P0");
  const p1s = summarizeFile(p1Dev, "P1");
  const p2s = p2Dev ? summarizeFile(p2Dev, "P2") : null;
  const p3s = summarizeFile(p3Dev, "P3");

  if (p0s || p1s || p2s || p3s) {
    lines.push("## Dev split — routing policies", "");
    lines.push("| Policy | n | mean (ms) | p50 | p95 | tier 1 | tier 3 | router |");
    lines.push("|--------|---|-----------|-----|-----|--------|--------|--------|");
    for (const [name, s] of [
      ["P0", p0s],
      ["P1", p1s],
      ["P2", p2s],
      ["P3", p3s],
    ]) {
      if (!s) continue;
      const rv = s.router_version ? JSON.stringify(s.router_version) : "—";
      lines.push(
        `| ${name} | ${s.n} | ${s.mean_latency_ms} | ${s.p50_latency_ms} | ${s.p95_latency_ms} | ${s.routing_tier[1] ?? 0} | ${s.routing_tier[3] ?? 0} | ${rv} |`,
      );
    }
    if (p0s?.mean_latency_ms && p1s?.mean_latency_ms) {
      lines.push(
        `- P1 vs P0 mean latency: ~${pctDelta(p0s.mean_latency_ms, p1s.mean_latency_ms)}% lower`,
      );
    }
    if (p0s?.mean_latency_ms && p3s?.mean_latency_ms) {
      lines.push(
        `- P3 vs P0 mean latency: ~${pctDelta(p0s.mean_latency_ms, p3s.mean_latency_ms)}% lower`,
      );
    }
    if (p1s?.mean_latency_ms && p3s?.mean_latency_ms) {
      const pct = pctDelta(p3s.mean_latency_ms, p1s.mean_latency_ms);
      lines.push(`- P1 vs P3 mean latency: P1 ~${pct}% faster`);
    }
    lines.push("");
  }

  if (p1Test?.length || p3Test?.length) {
    lines.push("## Test split — P1 vs P3 (no oracle labels)", "");
    const p1t = summarizeFile(p1Test, "P1");
    const p3t = summarizeFile(p3Test, "P3");
    if (p1t) {
      lines.push(
        `- **P1**: n=${p1t.n}, mean ${p1t.mean_latency_ms} ms, tiers ${JSON.stringify(p1t.routing_tier)}`,
      );
    }
    if (p3t) {
      lines.push(
        `- **P3**: n=${p3t.n}, mean ${p3t.mean_latency_ms} ms, tiers ${JSON.stringify(p3t.routing_tier)}`,
      );
    }
    if (p1t?.mean_latency_ms && p3t?.mean_latency_ms) {
      lines.push(
        `- P1 vs P3: P1 ~${pctDelta(p3t.mean_latency_ms, p1t.mean_latency_ms)}% faster on test`,
      );
    }
    lines.push("");
  }

  for (const gap of [
    oracleGap(p1Dev, labels, "P1", "P1"),
    p2Dev ? oracleGap(p2Dev, labels, "P2", "P2") : null,
    oracleGap(p3Dev, labels, "P3", "P3"),
  ].filter(Boolean)) {
    if (!gap) continue;
    lines.push(`## ${gap.label} vs oracle (dev)`, "");
    lines.push(`- Matched prompts: ${gap.matched}`);
    lines.push(`- Correct tier: ${gap.correct} (${gap.correct_pct}%)`);
    lines.push(`- Under-routed (quality risk): ${gap.underRoute}`);
    lines.push(`- Over-routed (energy waste): ${gap.overRoute}`);
    lines.push("");
  }

  const classroom100 = join(runsDir, "classroom", "classroom-p1-100-v1-summary.txt");
  if (existsSync(classroom100)) {
    lines.push("## Classroom stress (100 students)", "");
    lines.push(`- Summary: \`${classroom100}\``);
    lines.push("- See `URA/docs/research/findings/STRESS_TEST_REPORT.md`");
    lines.push("");
  }

  lines.push("## Remaining work", "");
  lines.push("- [ ] P0 test v2 — complete sequential test-split triangle");
  lines.push("- [ ] #501 main-baseline on my.eduai — compare RAG pipeline vs latest");
  lines.push("- [ ] Under-route **live re-benchmark** — rules merged (`5f349b19`); re-run P1 dev on s378");
  lines.push("- [ ] s378 smoke — fresh session cookie; verify `auto` / `auto-llm` + non-zero `prompt_tokens` + energy sidecar");
  lines.push("- [ ] Policy-scale energy — P0/P1 with Joules after token fix validated on dev");
  lines.push("- [ ] Advisor review — share `PAPER1_ROUTING_SECTION.md` + status memo");
  lines.push("");
  lines.push("**Done (2026-06-24):** P1 under-route rules (`5f349b19`, 10/10 unit tests); Paper 2 outline; advisor packet; kNN LOO 80.2%.");
  lines.push("**Done (2026-06-23):** #501 trim (RAG + energy via :8001 proxy), strict kNN exemplars built, token usage fix (`generateText` + stream `includeUsage`).");
  lines.push("**Done (2026-06-18):** strict relabel, P3 mapping tune, P1/P2/P3 dev benchmark, 100-student classroom.");
  lines.push("");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log("=== research status report ===");
  console.log("output:", outPath);
  console.log(lines.join("\n"));
}

main();
