#!/usr/bin/env node
/**
 * Export a human review worksheet for judge validation (markdown).
 *
 * Default prompts: ts-037, ts-118, ts-042, ts-111 (override with RESEARCH_HUMAN_CHECK_IDS)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOkRow, loadRunRows, pairByPrompt } from "./both-tier-io.mjs";
import { DEFAULT_BOTH_TIER_IN, DEFAULT_LABELS_OUT, RUNS_DIR } from "./paths.mjs";

const DEFAULT_IDS = ["ts-037", "ts-118", "ts-042", "ts-111"];

function readEnv(name) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function loadJsonl(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

function mdEscape(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function main() {
  const runsPath = readEnv("RESEARCH_HUMAN_CHECK_IN") ?? DEFAULT_BOTH_TIER_IN;
  const labelsPath = readEnv("RESEARCH_HUMAN_CHECK_LABELS") ?? DEFAULT_LABELS_OUT;
  const strictPath = readEnv("RESEARCH_HUMAN_CHECK_STRICT");
  const outPath =
    readEnv("RESEARCH_HUMAN_CHECK_OUT") ??
    join(RUNS_DIR, "human-spot-check-worksheet.md");

  const ids = (readEnv("RESEARCH_HUMAN_CHECK_IDS") ?? DEFAULT_IDS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const pairs = pairByPrompt(loadRunRows(runsPath));
  const labels = new Map(loadJsonl(labelsPath).map((l) => [l.prompt_id, l]));
  const strict = strictPath
    ? new Map(loadJsonl(strictPath).map((l) => [l.prompt_id, l]))
    : new Map();

  const lines = [
    "# Human spot-check — judge validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Instructions: For each prompt, read the student question and both model answers.",
    "Mark whether tier 1 (7B) is adequate on its own, whether tier 3 adds meaningful value,",
    "and your `min_adequate_tier` (1 or 3). Compare with default and strict LLM judges below.",
    "",
    "---",
    "",
  ];

  for (const id of ids) {
    const tiers = pairs.get(id);
    if (!tiers) {
      lines.push(`## ${id}`, "", "_Missing from both-tier baseline._", "", "---", "");
      continue;
    }
    const t1 = isOkRow(tiers[1]) ? tiers[1] : null;
    const t3 = isOkRow(tiers[3]) ? tiers[3] : null;
    const meta = t1 ?? t3;
    const label = labels.get(id);
    const strictRow = strict.get(id);

    lines.push(`## ${id}`);
    lines.push("");
    lines.push(`- **Stratum:** ${meta.stratum}`);
    lines.push(`- **Category:** ${meta.category}`);
    lines.push(`- **Tools expected:** ${meta.tools_expected}`);
    lines.push("");
    lines.push("### Student prompt");
    lines.push("");
    lines.push("```");
    lines.push(mdEscape(meta.prompt));
    lines.push("```");
    lines.push("");
    lines.push("### Tier 1 (7B) response");
    lines.push("");
    lines.push("```");
    lines.push(mdEscape(t1?.response ?? "[missing]"));
    lines.push("```");
    lines.push("");
    lines.push("### Tier 3 (32B) response");
    lines.push("");
    lines.push("```");
    lines.push(mdEscape(t3?.response ?? "[missing]"));
    lines.push("```");
    lines.push("");
    lines.push("### LLM judges (for reference)");
    lines.push("");
    if (label) {
      lines.push(
        `- **Default judge:** min_adequate_tier=${label.min_adequate_tier}, tier_sensitive=${label.tier_sensitive}`,
      );
      if (label.judge_rationale) {
        lines.push(`  - Rationale: ${label.judge_rationale.replace(/\n/g, " ")}`);
      }
    } else {
      lines.push("- **Default judge:** (no label row)");
    }
    if (strictRow?.strict) {
      const s = strictRow.strict;
      lines.push(
        `- **Strict judge:** min_adequate_tier=${s.min_adequate_tier}, tier_sensitive=${s.tier_sensitive}`,
      );
      if (s.rationale) {
        lines.push(`  - Rationale: ${s.rationale.replace(/\n/g, " ")}`);
      }
    } else if (strictRow?.error) {
      lines.push(`- **Strict judge:** ERROR ${strictRow.error}`);
    }
    lines.push("");
    lines.push("### Your review (fill in)");
    lines.push("");
    lines.push("| Field | Your answer |");
    lines.push("|-------|-------------|");
    lines.push("| Tier 1 adequate? (yes / degraded / no) | |");
    lines.push("| Tier 3 needed for adequacy? (yes / no) | |");
    lines.push("| min_adequate_tier (1 or 3) | |");
    lines.push("| tier_sensitive (yes / no) | |");
    lines.push("| Notes | |");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outPath} (${ids.length} prompts)`);
}

main();
