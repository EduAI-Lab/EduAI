#!/usr/bin/env tsx
/**
 * PREREG_v3.md §7 P1 rule-stack evaluation: run the live rule-based router
 * (apps/core/app/lib/ai/routing/rules.ts) against the v3 dev split's
 * minimum-adequate-tier labels (117 prompts: 50 Stage 5 calibration + 67
 * Stage 6 fresh-dev, all pairwise-labeled small/large).
 *
 * This is read-only evaluation. It does not modify rules.ts. Output is a
 * per-rule and overall accuracy breakdown against the oracle label, used to
 * draft RULE_STACK_v3.md.
 *
 * Known limitation: ragContextTokenEstimate (rule 5's threshold input) is
 * not captured anywhere in the v3 generation pipeline (chat.ts never
 * returns retrieved-chunk text, only similarity/count) -- rule 5 is
 * evaluated using ragChunkCount alone as a proxy and flagged as such in the
 * per-row output, since ctxTok is left undefined for every row.
 *
 * Usage: npm run research:eval-p1-rules-v3-dev   (from apps/core)
 *   or:  tsx ./scripts/research/evaluate-p1-rules-v3-dev.ts <path-to-dev-rule-eval-input.jsonl>
 */
import { readFileSync } from "node:fs";
import { matchPhase1Rules, type Phase1RouterContext } from "~/lib/ai/routing/rules";
import { needsCourseRag } from "~/lib/ai/chat-intent";

type DevRow = {
  promptId: string;
  prompt: string;
  category: string;
  stratum: string;
  rag_context: string;
  courseId: string | null;
  ragTopSimilarity: number | null;
  ragChunkCount: number | null;
  label: "small" | "large";
  tierNumeral: string;
  escalated: boolean;
};

function loadJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as T);
}

// Rule outcomes are 1/2/3 (small/mid/large); the oracle label is small/large
// (binary, per §6.1 -- P1 never sees a "tier 2" ground truth). A rule pick
// of exactTier:1 or the images minTier:2 floor both count as "small" for
// this binary comparison unless minTier resolves higher; tier 2/3 picks
// count as "large" (i.e. "not the small tier" == escalate), matching how
// the live router treats tier>=2 as routing away from the cheapest model.
function pickToLabel(pick: ReturnType<typeof matchPhase1Rules>["pick"]): "small" | "large" {
  if (pick.kind === "exactTier") {
    return pick.tier === 1 ? "small" : "large";
  }
  // minTier (images rule): minTier >= 2 always routes away from tier 1.
  return pick.minTier >= 2 ? "large" : "small";
}

async function main() {
  const inputPath = process.argv[2] || "../../docs/research/v3/results/dev-rule-eval-input.jsonl";
  const rows = loadJsonl<DevRow>(inputPath);

  console.error(`Loaded ${rows.length} dev rows.`);

  type Outcome = {
    promptId: string;
    category: string;
    stratum: string;
    oracle: "small" | "large";
    ruleId: string;
    predicted: "small" | "large";
    correct: boolean;
    underServe: boolean; // oracle=large, predicted=small (the costly miss)
    overServe: boolean; // oracle=small, predicted=large (wasteful but safe)
  };

  const outcomes: Outcome[] = [];

  for (const row of rows) {
    const hasCourse = Boolean(row.courseId);
    const courseRagNeeded = needsCourseRag(row.prompt, hasCourse);

    const ctx: Phase1RouterContext = {
      prompt: row.prompt,
      imagesPresent: false, // v3 suite has no image prompts (PREREG §3.3 exclusion)
      courseId: row.courseId,
      ragTopSimilarity: row.ragTopSimilarity,
      ragChunkCount: row.ragChunkCount,
      ragContextTokenEstimate: undefined, // not captured in v3 pipeline; see header note
      courseRagNeeded,
    };

    const match = matchPhase1Rules(ctx);
    const predicted = pickToLabel(match.pick);
    const oracle = row.label;

    outcomes.push({
      promptId: row.promptId,
      category: row.category,
      stratum: row.stratum,
      oracle,
      ruleId: match.rule,
      predicted,
      correct: predicted === oracle,
      underServe: oracle === "large" && predicted === "small",
      overServe: oracle === "small" && predicted === "large",
    });
  }

  const total = outcomes.length;
  const correct = outcomes.filter((o) => o.correct).length;
  const underServes = outcomes.filter((o) => o.underServe).length;
  const overServes = outcomes.filter((o) => o.overServe).length;
  const escalations = outcomes.filter((o) => o.oracle === "large").length;
  const escalationsCaught = outcomes.filter((o) => o.oracle === "large" && !o.underServe).length;

  console.log(`\n=== Overall (n=${total}) ===`);
  console.log(`Accuracy: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%)`);
  console.log(`Under-serves (oracle=large, predicted=small): ${underServes}/${total} (${(100 * underServes / total).toFixed(1)}%)`);
  console.log(`Over-serves (oracle=small, predicted=large): ${overServes}/${total} (${(100 * overServes / total).toFixed(1)}%)`);
  console.log(`Escalation catch rate: ${escalationsCaught}/${escalations} (${escalations > 0 ? (100 * escalationsCaught / escalations).toFixed(1) : "n/a"}%)`);

  console.log(`\n=== By rule fired ===`);
  const byRule = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    if (!byRule.has(o.ruleId)) byRule.set(o.ruleId, []);
    byRule.get(o.ruleId)!.push(o);
  }
  for (const [ruleId, os] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const c = os.filter((o) => o.correct).length;
    console.log(`  ${ruleId}: n=${os.length}, correct=${c} (${(100 * c / os.length).toFixed(1)}%)`);
  }

  console.log(`\n=== By category ===`);
  const byCategory = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    if (!byCategory.has(o.category)) byCategory.set(o.category, []);
    byCategory.get(o.category)!.push(o);
  }
  for (const [cat, os] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const c = os.filter((o) => o.correct).length;
    const us = os.filter((o) => o.underServe).length;
    console.log(`  ${cat}: n=${os.length}, correct=${c} (${(100 * c / os.length).toFixed(1)}%), under-serves=${us}`);
  }

  console.log(`\n=== Under-serve misses (the costly failure mode) ===`);
  for (const o of outcomes.filter((o) => o.underServe)) {
    console.log(`  ${o.promptId} [${o.category}/${o.stratum}] fired ${o.ruleId}, oracle=large predicted=small`);
  }

  console.log(`\n=== Escalation rules that never fired on dev ===`);
  const allEscalationRules = [
    "rule2_web_lookup_tier_3",
    "rule2b_debug_tier_3",
    "rule2c_complex_task_tier_3",
    "rule2d_rag_reasoning_tier_3",
    "rule2e_distinct_enumeration_tier_3",
  ];
  for (const r of allEscalationRules) {
    if (!byRule.has(r)) console.log(`  ${r}: NEVER FIRED`);
  }

  console.log(`\nNote: rule5 (long-RAG) evaluated with ragContextTokenEstimate=undefined (not captured in this pipeline) -- any row landing on rule5 is falling through on ragChunkCount alone, see header note.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
