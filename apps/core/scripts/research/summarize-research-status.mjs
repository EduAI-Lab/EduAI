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
 *   RESEARCH_POLICY_OUT     policy JSONL (default policy-runs.v1.jsonl)
 *   RESEARCH_POLICY_P1_DEV  P1 dev run (default policy-runs-p1-dev.jsonl if exists)
 *   RESEARCH_POLICY_TEST    test policy run (default policy-runs-test.energy.v2.jsonl if exists)
 *   RESEARCH_LABEL_OUT      labels (default labels.v1.jsonl)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LABELS_OUT,
  DEFAULT_POLICY_OUT,
  RUNS_DIR,
} from "./paths.mjs";

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

function policySummary(rows, pol) {
  const ok = rows.filter((r) => r.policy === pol && !r.error && r.response);
  if (!ok.length) return null;
  const durs = ok.map((r) => r.duration_ms);
  const out = {
    n: ok.length,
    mean_latency_ms: Math.round(mean(durs)),
    errors: rows.filter((r) => r.policy === pol && (r.error || r.http_status >= 400)).length,
  };
  if (pol === "P1") {
    const tiers = { 1: 0, 2: 0, 3: 0, null: 0 };
    for (const r of ok) {
      const t = r.routing_tier ?? null;
      tiers[t] = (tiers[t] ?? 0) + 1;
    }
    out.routing_tier = tiers;
    const withTokens = ok.filter((r) => r.prompt_tokens != null).length;
    const withEnergy = ok.filter((r) => r.energy_joules != null).length;
    out.prompt_tokens_filled = `${withTokens}/${ok.length}`;
    out.energy_joules_filled = `${withEnergy}/${ok.length}`;
  }
  return out;
}

function oracleGap(p1Dev, labels) {
  if (!p1Dev?.length || !labels?.length) return null;
  const labelById = new Map(labels.map((l) => [l.prompt_id, l]));
  let matched = 0;
  let correct = 0;
  let underRoute = 0;
  let overRoute = 0;

  for (const row of p1Dev.filter((r) => !r.error)) {
    const label = labelById.get(row.prompt_id);
    if (!label || label.min_adequate_tier == null) continue;
    matched++;
    const chosen = row.routing_tier ?? 1;
    const oracle = label.min_adequate_tier;
    if (chosen === oracle) correct++;
    else if (chosen < oracle) underRoute++;
    else overRoute++;
  }

  if (!matched) return null;
  return {
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
  };
}

function main() {
  const runsDir = readEnv("RESEARCH_RUNS_DIR") ?? RUNS_DIR;
  const date = new Date().toISOString().slice(0, 10);
  const outPath =
    readEnv("RESEARCH_STATUS_OUT") ?? join(runsDir, `research-status-${date}.md`);

  const labelsPath = readEnv("RESEARCH_LABEL_OUT") ?? DEFAULT_LABELS_OUT;
  const p1DevPath = pickPath(
    readEnv("RESEARCH_POLICY_P1_DEV"),
    join(runsDir, "policy-runs-p1-dev.jsonl"),
    "/tmp/policy-runs-p1-dev.jsonl",
  );
  const testPath = pickPath(
    readEnv("RESEARCH_POLICY_TEST"),
    join(runsDir, "policy-runs-test.energy.v2.jsonl"),
    "/tmp/policy-runs-test.energy.v2.jsonl",
    DEFAULT_POLICY_OUT,
  );

  const labels = loadJsonl(labelsPath);
  const p1Dev = loadJsonl(p1DevPath);
  const testRuns = loadJsonl(testPath);

  const lines = [
    "# EduAI URA — Research status",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Artifacts",
    "",
    `| File | Status |`,
    `|------|--------|`,
    `| Labels \`${labelsPath}\` | ${labels ? `${labels.length} rows` : "missing"} |`,
    `| P1 dev \`${p1DevPath}\` | ${p1Dev ? `${p1Dev.length} rows` : "missing — run tier-a batch"} |`,
    `| Test policy \`${testPath}\` | ${testRuns ? `${testRuns.length} rows` : "missing"} |`,
    "",
  ];

  const ls = labelStats(labels);
  if (ls) {
    lines.push("## Label corpus", "");
    lines.push(`- Rows: ${ls.rows}`);
    lines.push(`- Tier-sensitive: ${ls.tier_sensitive}`);
    lines.push(`- \`min_adequate_tier=3\`: ${ls.min_adequate_tier_3}`);
    lines.push("");
  }

  if (testRuns?.length) {
    lines.push("## Test split — P0 vs P1 (preliminary)", "");
    const p0 = policySummary(testRuns, "P0");
    const p1 = policySummary(testRuns, "P1");
    if (p0) {
      lines.push(`- **P0** (always 32B): n=${p0.n}, mean latency ${p0.mean_latency_ms} ms`);
    }
    if (p1) {
      lines.push(
        `- **P1** (rules Auto): n=${p1.n}, mean latency ${p1.mean_latency_ms} ms, tier mix ${JSON.stringify(p1.routing_tier)}`,
      );
      if (p0?.mean_latency_ms && p1.mean_latency_ms) {
        const pct = (((p0.mean_latency_ms - p1.mean_latency_ms) / p0.mean_latency_ms) * 100).toFixed(1);
        lines.push(`- P1 vs P0 latency: ~${pct}% ${p1.mean_latency_ms < p0.mean_latency_ms ? "lower" : "higher"}`);
      }
      lines.push(`- Token telemetry filled: ${p1.prompt_tokens_filled}`);
      lines.push(`- Energy Joules filled: ${p1.energy_joules_filled}`);
    }
    lines.push("");
  }

  const gap = oracleGap(p1Dev, labels);
  if (gap) {
    lines.push("## P1 vs oracle (dev)", "");
    lines.push(`- Matched prompts: ${gap.matched}`);
    lines.push(`- Correct tier: ${gap.correct} (${gap.correct_pct}%)`);
    lines.push(`- Under-routed (quality risk): ${gap.underRoute}`);
    lines.push(`- Over-routed (energy waste): ${gap.overRoute}`);
    lines.push("");
    if (gap.underRoute + gap.overRoute < gap.matched * 0.05) {
      lines.push(
        "> **Note:** Small gap — P3 learned router may not be justified; focus energy measurement + honest null.",
      );
      lines.push("");
    }
  } else if (p1Dev === null) {
    lines.push("## P1 vs oracle (dev)", "");
    lines.push("Not yet run. On s378: `bash scripts/research/run-s378-tier-a.sh`");
    lines.push("");
  }

  lines.push("## Next steps", "");
  lines.push("1. Human spot-check disputed labels (`npm run research:export-human-check`)");
  lines.push("2. cmps01 energy sidecar + small measured re-run (Paper 2)");
  lines.push("3. Offline kNN eval if oracle gap exists (`npm run research:eval-knn`)");
  lines.push("4. Advisor review of this memo");
  lines.push("");

  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log("=== research status report ===");
  console.log("output:", outPath);
  console.log(lines.join("\n"));
}

main();
