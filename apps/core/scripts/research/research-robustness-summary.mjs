#!/usr/bin/env node
/**
 * Summarize routing/energy robustness across replicate runs and sensitivity groups.
 *
 * Usage:
 *   node research-robustness-summary.mjs <policy-runs.jsonl> [prompts.v2.jsonl]
 *
 * Reports:
 *   - Per-prompt tier/rule agreement across replicates (P1)
 *   - Energy/latency mean ± std and CV% per prompt
 *   - Sensitivity group flip rates vs base (replicate_of)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolvePromptsPath } from "./paths.mjs";
import { rowMatchesPolicy } from "./policy-ids.mjs";

function loadJsonl(path) {
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

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function cvPct(xs) {
  const m = mean(xs);
  return m > 0 ? (std(xs) / m) * 100 : 0;
}

function agreement(values) {
  if (!values.length) return { n: 0, agree: 0, pct: 0 };
  const first = values[0];
  const agree = values.every((v) => v === first);
  return { n: values.length, agree: agree ? 1 : 0, pct: agree ? 100 : 0 };
}

function summarizePromptReplicates(rows, policy) {
  const ok = rows.filter(
    (r) =>
      rowMatchesPolicy(r, policy) &&
      r.http_status === 200 &&
      !r.error &&
      r.prompt_id,
  );
  const byPrompt = new Map();
  for (const row of ok) {
    const rep = row.replicate ?? 1;
    const bucket = byPrompt.get(row.prompt_id) ?? [];
    bucket.push({ ...row, replicate: rep });
    byPrompt.set(row.prompt_id, bucket);
  }

  const perPrompt = [];
  for (const [prompt_id, reps] of byPrompt) {
    reps.sort((a, b) => a.replicate - b.replicate);
    const tiers = reps.map((r) => r.routing_tier ?? null);
    const rules = reps.map((r) => r.router_rule ?? null);
    const durs = reps.map((r) => r.duration_ms).filter((n) => Number.isFinite(n));
    const joules = reps
      .map((r) => r.energy_joules)
      .filter((n) => n != null && Number.isFinite(n));

    const tierAg = agreement(tiers);
    const ruleAg = agreement(rules);

    perPrompt.push({
      prompt_id,
      replicates: reps.length,
      tier_values: tiers,
      tier_agreement_pct: tierAg.pct,
      rule_values: rules,
      rule_agreement_pct: ruleAg.pct,
      mean_ms: mean(durs),
      std_ms: std(durs),
      cv_ms_pct: cvPct(durs),
      mean_j: joules.length ? mean(joules) : null,
      std_j: joules.length ? std(joules) : null,
      cv_j_pct: joules.length ? cvPct(joules) : null,
    });
  }

  perPrompt.sort((a, b) => a.prompt_id.localeCompare(b.prompt_id));
  return perPrompt;
}

function summarizeSensitivityGroups(prompts, perPromptP1) {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const tierById = new Map(perPromptP1.map((p) => [p.prompt_id, p.tier_values?.[0] ?? null]));

  const groups = new Map();
  for (const p of prompts) {
    if (!p.sensitivity_group || !p.replicate_of) continue;
    const g = groups.get(p.sensitivity_group) ?? {
      group: p.sensitivity_group,
      base_id: p.replicate_of,
      base_tier: tierById.get(p.replicate_of) ?? null,
      variants: [],
    };
    g.variants.push({
      id: p.id,
      tier: tierById.get(p.id) ?? null,
      notes: p.notes ?? "",
    });
    groups.set(p.sensitivity_group, g);
  }

  const results = [];
  for (const g of groups.values()) {
    const baseTier = g.base_tier;
    const variantTiers = g.variants.map((v) => v.tier);
    const comparable = variantTiers.filter((t) => t != null && baseTier != null);
    const flips = comparable.filter((t) => t !== baseTier).length;
    results.push({
      ...g,
      variant_count: g.variants.length,
      tier_flip_count: flips,
      tier_flip_rate_pct:
        comparable.length > 0 ? (flips / comparable.length) * 100 : null,
    });
  }

  results.sort((a, b) => a.group.localeCompare(b.group));
  return results;
}

function main() {
  const runsPath = process.argv[2];
  const promptsPath = process.argv[3] ?? resolvePromptsPath();
  if (!runsPath) {
    console.error(
      "Usage: node research-robustness-summary.mjs <policy-runs.jsonl> [prompts.jsonl]",
    );
    process.exit(1);
  }
  if (!existsSync(runsPath)) {
    console.error("Missing runs file:", runsPath);
    process.exit(1);
  }

  const rows = loadJsonl(runsPath);
  const prompts = existsSync(promptsPath) ? loadJsonl(promptsPath) : [];

  console.log("=== robustness summary ===");
  console.log("runs:", runsPath);
  console.log("rows:", rows.length);
  console.log("");

  for (const policy of ["P1", "P0"]) {
    const perPrompt = summarizePromptReplicates(rows, policy);
    if (!perPrompt.length) {
      console.log(`(${policy}: no successful rows)`);
      continue;
    }

    const tierAgree = perPrompt.filter((p) => p.tier_agreement_pct === 100).length;
    const ruleAgree = perPrompt.filter((p) => p.rule_agreement_pct === 100).length;
    const withEnergy = perPrompt.filter((p) => p.mean_j != null);

    console.log(`--- ${policy} (${perPrompt.length} prompts) ---`);
    console.log(
      `tier agreement: ${tierAgree}/${perPrompt.length} prompts (${((tierAgree / perPrompt.length) * 100).toFixed(1)}%)`,
    );
    if (policy === "P1") {
      console.log(
        `router_rule agreement: ${ruleAgree}/${perPrompt.length} prompts (${((ruleAgree / perPrompt.length) * 100).toFixed(1)}%)`,
      );
    }
    if (withEnergy.length) {
      const meanCv = mean(withEnergy.map((p) => p.cv_j_pct ?? 0));
      console.log(
        `energy CV%: mean ${meanCv.toFixed(1)}% across ${withEnergy.length} prompts with Joules`,
      );
    }

    const unstable = perPrompt.filter(
      (p) => p.tier_agreement_pct < 100 || (p.cv_j_pct != null && p.cv_j_pct > 10),
    );
    if (unstable.length) {
      console.log("flagged (tier flip and/or energy CV > 10%):");
      for (const p of unstable) {
        console.log(
          `  ${p.prompt_id}: tiers=${JSON.stringify(p.tier_values)} ` +
            `mean_j=${p.mean_j?.toFixed(1) ?? "n/a"} cv_j=${p.cv_j_pct?.toFixed(1) ?? "n/a"}%`,
        );
      }
    }
    console.log("");
  }

  if (prompts.length) {
    const p1 = summarizePromptReplicates(rows, "P1");
    const sens = summarizeSensitivityGroups(prompts, p1);
    if (sens.length) {
      console.log("--- sensitivity groups (P1 tier vs base) ---");
      for (const g of sens) {
        const rate =
          g.tier_flip_rate_pct != null ? `${g.tier_flip_rate_pct.toFixed(0)}%` : "n/a";
        console.log(
          `${g.group}: base=${g.base_id} tier=${g.base_tier} ` +
            `flips=${g.tier_flip_count}/${g.variant_count} (${rate})`,
        );
      }
      console.log("");
    }
  }
}

main();
