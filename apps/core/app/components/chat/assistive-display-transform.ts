/**
 * Display-only Assistive mode transforms for assistant messages (#699, #1060).
 *
 * Policy and stored DB text keep **Top summary** / **Next?** for oversight metrics.
 * Apply at render time in ChatMessage only — never before persistence.
 *
 * Display order (when sections exist):
 *   Step ladder → eduai-diagram → (optional other body) → TLDR → Continue
 *
 * When an eduai-diagram lists labeled stages (any catalog type), incomplete
 * Step ladder or Top summary blocks are completed from those stages.
 */

import {
  parseEduaiDiagramBody,
  type EduaiDiagramStage,
} from "~/lib/ai/eduai-diagram-payload";
import { EDUAI_DIAGRAM_FENCE_GLOBAL } from "~/lib/ai/eduai-diagram-type";

/** Heading line that opens the Top summary / TLDR block (case-insensitive). */
const TOP_SUMMARY_HEADING = /^\*\*Top summary\*\*\s*$/i;

const STEP_LADDER_HEADING = /^#{1,6}\s*Step ladder\s*$/i;

const NEXT_HEADING = /^\*\*Next\?\*\*/i;

/**
 * Structural markers that end the Top summary section when they appear as a
 * line start (body / steps / CTA / footers).
 */
const SECTION_BOUNDARY =
  /^(?:#{1,6}\s|\*\*Next\?\*\*|Sources:|\*\*Sources|\*\*Connects to|Quick check|```)/i;

/**
 * Display-only: rebuild Assist replies as Step ladder → diagram → TLDR → Continue,
 * then relabel headings. Non-Assist / redirect turns without Top summary are
 * unchanged aside from any Next? relabel (unless a diagram is present).
 */
export function transformAssistiveDisplayCopy(content: string): string {
  const reordered = reorderAssistiveSections(content);
  return relabelAssistiveHeadings(reordered);
}

function relabelAssistiveHeadings(content: string): string {
  return content
    .replace(/\*\*Top summary\*\*/gi, "**TLDR**")
    .replace(/\*\*Next\?\*\*/g, "**Continue**")
    .replace(/^Next\?\s+/gm, "Continue: ");
}

function reorderAssistiveSections(content: string): string {
  const top = extractTopSummarySection(content);
  const step = extractStepLadderSection(content);
  const diagrams = extractEduaiDiagramFences(content);
  const next = extractNextSection(content);

  // Nothing structural to reshape — keep original (Next? still relabeled later).
  if (!top && !step && diagrams.length === 0) {
    return content;
  }

  const usedRanges: Array<{ start: number; end: number }> = [];
  if (top) usedRanges.push({ start: top.start, end: top.end });
  if (step) usedRanges.push({ start: step.start, end: step.end });
  for (const diagram of diagrams) {
    usedRanges.push({ start: diagram.start, end: diagram.end });
  }
  if (next) usedRanges.push({ start: next.start, end: next.end });

  const remainder = stripRanges(content, usedRanges)
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const primary = diagrams[0] ?? null;
  const stages = primary ? parseEduaiDiagramBody(primary.body).stages : [];

  let tldrBlock = completeTldrFromStages(top?.text ?? null, stages);
  if (!tldrBlock && stages.length > 0) {
    const synthesized = synthesizeTldrLines(stages);
    if (synthesized) tldrBlock = `**Top summary**\n${synthesized}`;
  }

  const stepText = completeStepLadderFromStages(step?.text ?? null, stages);

  const parts: string[] = [];
  if (stepText) parts.push(stepText);
  if (diagrams.length > 0) {
    parts.push(diagrams.map((d) => d.text.trim()).join("\n\n"));
  }

  if (remainder) {
    // With Step ladder / diagram, drop only remainder blocks proven to
    // duplicate the rendered ladder/diagram/TLDR (stage lists, repeated
    // prose); substantive explanations are kept (#1091 review).
    // Without them, keep the body explanation before the TLDR (#1060).
    const kept =
      stepText || diagrams.length > 0
        ? dropDuplicateRemainderBlocks(remainder, stages, [
            stepText,
            ...diagrams.map((d) => d.text),
            tldrBlock,
          ])
        : remainder.trim();
    if (kept) parts.push(kept);
  }
  if (tldrBlock) {
    const prefix = parts.length > 0 ? "---\n\n" : "";
    parts.push(`${prefix}${tldrBlock}`);
  }
  if (next) parts.push(next.text.trim());

  if (parts.length === 0) return content;
  return normalizeGaps(parts.join("\n\n"));
}

/**
 * With a Step ladder / diagram present, remove only remainder blocks proven
 * to duplicate already-rendered content; keep everything else (#1091 review).
 *
 * A block is a duplicate when every line in it is either:
 *   - a list item whose leading label matches a diagram stage label,
 *   - prose already contained verbatim in the rendered ladder/diagram/TLDR, or
 *   - a short lead-in ending with ":" that only introduces duplicate list items.
 */
function dropDuplicateRemainderBlocks(
  remainder: string,
  stages: EduaiDiagramStage[],
  renderedParts: Array<string | null>,
): string {
  const stageKeys = new Set(stages.map((s) => normalizeLabelKey(s.label)));
  const renderedProse = normalizeProse(
    renderedParts.filter((part): part is string => Boolean(part)).join("\n"),
  );

  const blocks = remainder.split(/\n{2,}/);
  const kept = blocks.filter(
    (block) =>
      block.trim() !== "" &&
      !isDuplicateRemainderBlock(block, stageKeys, renderedProse),
  );
  return kept.join("\n\n").trim();
}

function isDuplicateRemainderBlock(
  block: string,
  stageKeys: Set<string>,
  renderedProse: string,
): boolean {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return true;

  const duplicates = lines.map((line) =>
    isDuplicateRemainderLine(line, stageKeys, renderedProse),
  );

  // A lead-in ending with ":" counts as duplicate when everything after it in
  // the block is duplicate list content (e.g. "Here's a sketch:" + stage list).
  for (let i = 0; i < lines.length; i++) {
    if (duplicates[i]) continue;
    const rest = lines.slice(i + 1);
    if (
      /:\s*$/.test(lines[i]) &&
      rest.length > 0 &&
      rest.every((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line)) &&
      duplicates.slice(i + 1).every(Boolean)
    ) {
      duplicates[i] = true;
    }
  }

  return duplicates.every(Boolean);
}

function isDuplicateRemainderLine(
  line: string,
  stageKeys: Set<string>,
  renderedProse: string,
): boolean {
  const listMatch = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
  if (listMatch) {
    const item = (listMatch[1] ?? "").trim();
    const bold = /^\*\*(.+?)\*\*/.exec(item);
    const label = bold?.[1] ?? item.split(/[:–—-]/, 1)[0] ?? item;
    if (stageKeys.has(normalizeLabelKey(label))) return true;
  }
  const normalized = normalizeProse(line);
  // Containment only for lines long enough that a match is meaningful.
  return normalized.length >= 10 && renderedProse.includes(normalized);
}

/** Lowercased alphanumeric words only — for duplicate-prose comparison. */
function normalizeProse(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function synthesizeTldrLines(stages: EduaiDiagramStage[]): string | null {
  if (stages.length === 0) return null;
  return stages
    .map((s) =>
      s.detail ? `- **${s.label}** — ${s.detail}` : `- **${s.label}**`,
    )
    .join("\n");
}

function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function countListItems(block: string, pattern: RegExp): number {
  return (block.match(pattern) ?? []).length;
}

function countMatchingStageLabels(
  block: string,
  stages: EduaiDiagramStage[],
  itemPattern: RegExp,
): number {
  const stageKeys = new Set(stages.map((s) => normalizeLabelKey(s.label)));
  let matched = 0;
  for (const match of block.matchAll(itemPattern)) {
    const item = (match[1] ?? match[2] ?? "").trim();
    const bold = /^\*\*(.+?)\*\*/.exec(item);
    const label = bold?.[1] ?? item.split(/[-–—:]/, 1)[0] ?? item;
    if (stageKeys.has(normalizeLabelKey(label))) matched += 1;
  }
  return matched;
}

/**
 * Complete / rebuild Top summary so it has one bullet per diagram stage.
 * Prefers existing bullets when their labels match a stage.
 */
function completeTldrFromStages(
  topBlock: string | null,
  stages: EduaiDiagramStage[],
): string | null {
  const existing = topBlock?.trim() || "";
  if (stages.length === 0) return existing || null;

  const bulletCount = countListItems(existing, /(?:^|\n)\s*[-*•]\s+/g);
  const labelMatches = countMatchingStageLabels(
    existing,
    stages,
    /(?:^|\n)\s*[-*•]\s+(.+)/g,
  );
  // Keep only when count is enough AND labels largely cover diagram stages.
  if (
    existing &&
    bulletCount >= stages.length &&
    labelMatches >= Math.ceil(stages.length / 2)
  ) {
    return existing;
  }

  const byLabel = new Map<string, string>();
  for (const match of existing.matchAll(/(?:^|\n)\s*[-*•]\s+(.+)/g)) {
    const item = (match[1] ?? "").trim();
    const bold = /^\*\*(.+?)\*\*/.exec(item);
    const label = bold?.[1] ?? item.split(/[-–—:]/, 1)[0] ?? item;
    byLabel.set(normalizeLabelKey(label), item);
  }

  const lines = stages.map((s) => {
    const prior = byLabel.get(normalizeLabelKey(s.label));
    if (prior) return `- ${prior.replace(/^[-*•]\s*/, "")}`;
    return s.detail
      ? `- **${s.label}** — ${s.detail}`
      : `- **${s.label}**`;
  });

  return normalizeGaps(["**Top summary**", ...lines].join("\n"));
}

/**
 * If the model under-emitted Step ladder items (progressive-disclosure habit)
 * but the diagram lists labeled stages, fill missing numbered steps for any
 * catalog type. Preserves richer existing step text when the stage label matches.
 */
function completeStepLadderFromStages(
  stepBlock: string | null,
  stages: EduaiDiagramStage[],
): string | null {
  const existing = stepBlock?.trim() || "";
  if (stages.length === 0) return existing || null;

  // Always rebuild when stages exist so Start-here / bold formatting stay
  // consistent (preserves richer prior step bodies via label/index match).
  const byLabel = new Map<string, string>();
  const byIndex = new Map<number, string>();
  for (const match of existing.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+(.+)/g)) {
    const idx = Number(match[1]);
    const body = normalizeStepBody(match[2] ?? "");
    if (!body) continue;
    byIndex.set(idx, body);
    const bold = /^\*\*(.+?)\*\*/.exec(body);
    const label = bold?.[1] ?? body.split(/[:–—-]/, 1)[0] ?? body;
    byLabel.set(normalizeLabelKey(label), body);
  }

  const startLine = resolveStartHereLine(existing, stages[0]?.label ?? "first step");

  const steps = stages.map((s, i) => {
    const prior =
      byLabel.get(normalizeLabelKey(s.label)) ?? byIndex.get(i + 1) ?? null;
    if (prior) return `${i + 1}. ${formatStepItem(s.label, prior)}`;
    return `${i + 1}. ${formatStepItem(s.label, s.detail || null)}`;
  });

  return normalizeGaps(["### Step ladder", startLine, ...steps].join("\n"));
}

/**
 * One clean "Start here:" line — never nested "Start here: Start here: …",
 * and only taken from pre-numbered preamble (not from step bodies).
 */
function resolveStartHereLine(existing: string, firstLabel: string): string {
  const preamble = existing.split(/\n\s*\d+[.)]\s+/, 1)[0] ?? "";
  const match = /Start here:\s*(.+)/i.exec(preamble);
  let target = (match?.[1] ?? `${firstLabel} (~2 min)`).trim();
  // Collapse accidental repeats from model output / prior transforms.
  target = target.replace(/^(?:Start here:\s*)+/i, "").trim();
  if (!target) target = `${firstLabel} (~2 min)`;
  return `Start here: ${target}`;
}

/** Strip Start-here prefix and raw markdown bold wrappers from a step body. */
function normalizeStepBody(raw: string): string {
  let body = raw.trim();
  body = body.replace(/^(?:Start here:\s*)+/i, "").trim();
  // Unwrap a single outer **…** so we can re-format consistently.
  const wrapped = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
  if (wrapped) {
    const head = (wrapped[1] ?? "").replace(/:\s*$/, "").trim();
    const rest = (wrapped[2] ?? "").replace(/^[:–—-]\s*/, "").trim();
    body = rest ? `${head}: ${rest}` : head;
  }
  return body;
}

/**
 * Format a numbered step for markdown: bold label, colon OUTSIDE bold.
 * (`**Label:**` often renders as visible `**:` in CommonMark.)
 */
function formatStepItem(label: string, detailOrPrior: string | null): string {
  if (!detailOrPrior) return `**${label}**`;

  let detail = normalizeStepBody(detailOrPrior);
  // Drop a leading "Label:" / "**Label**:" so we don't duplicate the title.
  detail = detail
    .replace(new RegExp(`^\\*\\*${escapeRegExp(label)}\\*\\*\\s*:?\\s*`, "i"), "")
    .replace(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, "i"), "")
    .trim();

  if (!detail || normalizeLabelKey(detail) === normalizeLabelKey(label)) {
    return `**${label}**`;
  }
  return `**${label}**: ${detail}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGaps(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function stripRanges(
  content: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  if (ranges.length === 0) return content;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const range of sorted) {
    if (range.start > cursor) out += content.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  out += content.slice(cursor);
  return out;
}

/**
 * Locate the Top summary heading + following list/blank lines until the next
 * structural section. Returns null when the heading is absent (e.g. redirect).
 */
function extractTopSummarySection(
  content: string,
): { text: string; start: number; end: number } | null {
  const lines = content.split("\n");
  let headingIdx = -1;
  let offset = 0;
  let headingStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (TOP_SUMMARY_HEADING.test(lines[i].trim())) {
      headingIdx = i;
      headingStart = offset;
      break;
    }
    offset += lines[i].length + 1;
  }

  if (headingIdx < 0) return null;

  let endIdx = headingIdx + 1;
  while (endIdx < lines.length) {
    const line = lines[endIdx];
    const trimmed = line.trim();

    if (trimmed === "") {
      endIdx++;
      continue;
    }

    if (SECTION_BOUNDARY.test(trimmed)) break;

    if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) {
      endIdx++;
      continue;
    }

    break;
  }

  while (endIdx > headingIdx + 1 && lines[endIdx - 1].trim() === "") {
    endIdx--;
  }

  const text = lines.slice(headingIdx, endIdx).join("\n");
  let end = headingStart + text.length;
  if (content[end] === "\n") end += 1;

  return { text, start: headingStart, end };
}

function extractStepLadderSection(
  content: string,
): { text: string; start: number; end: number } | null {
  const lines = content.split("\n");
  let headingIdx = -1;
  let offset = 0;
  let headingStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (STEP_LADDER_HEADING.test(lines[i].trim())) {
      headingIdx = i;
      headingStart = offset;
      break;
    }
    offset += lines[i].length + 1;
  }

  if (headingIdx < 0) return null;

  let endIdx = headingIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trim();
    if (
      NEXT_HEADING.test(trimmed) ||
      TOP_SUMMARY_HEADING.test(trimmed) ||
      /^Sources:/i.test(trimmed) ||
      /^\*\*Sources/i.test(trimmed) ||
      /^\*\*Connects to/i.test(trimmed) ||
      /^```/.test(trimmed) ||
      (/^#{1,6}\s/.test(trimmed) && !STEP_LADDER_HEADING.test(trimmed))
    ) {
      break;
    }
    endIdx++;
  }

  while (endIdx > headingIdx + 1 && lines[endIdx - 1].trim() === "") {
    endIdx--;
  }

  const text = lines.slice(headingIdx, endIdx).join("\n");
  let end = headingStart + text.length;
  if (content[end] === "\n") end += 1;
  return { text, start: headingStart, end };
}

function extractEduaiDiagramFences(
  content: string,
): Array<{ text: string; body: string; start: number; end: number }> {
  const fences: Array<{
    text: string;
    body: string;
    start: number;
    end: number;
  }> = [];
  EDUAI_DIAGRAM_FENCE_GLOBAL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EDUAI_DIAGRAM_FENCE_GLOBAL.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const endWithNl = content[end] === "\n" ? end + 1 : end;
    fences.push({
      text: match[0],
      body: match[1] ?? "",
      start,
      end: endWithNl,
    });
  }
  return fences;
}

function extractNextSection(
  content: string,
): { text: string; start: number; end: number } | null {
  const match = /\*\*Next\?\*\*[^\n]*/.exec(content);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  let end = start + match[0].length;
  if (content[end] === "\n") end += 1;
  return { text: match[0], start, end };
}
