/**
 * Display-only Assistive mode transforms for assistant messages (#699, #1060).
 *
 * Policy and stored DB text keep **Top summary** / **Next?** for oversight metrics.
 * Apply at render time in ChatMessage only — never before persistence.
 *
 * Display order (when sections exist):
 *   Step ladder → eduai-diagram → (optional other body) → TLDR → Continue
 *
 * When an eduai-diagram lists labeled stages (process-flow / hierarchy / compare),
 * incomplete Step ladder or Top summary blocks are completed from those stages so
 * every diagram type stays aligned — not just process-flow bill examples.
 */

import {
  parseEduaiDiagramBody,
  type EduaiDiagramStage,
} from "~/lib/ai/eduai-diagram-payload";

/** Heading line that opens the Top summary / TLDR block (case-insensitive). */
const TOP_SUMMARY_HEADING = /^\*\*Top summary\*\*\s*$/i;

const STEP_LADDER_HEADING = /^#{1,6}\s*Step ladder\s*$/i;

const NEXT_HEADING = /^\*\*Next\?\*\*/i;

const EDUAI_DIAGRAM_FENCE =
  /```eduai-diagram[^\n]*\r?\n([\s\S]*?)```/i;

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
  const diagram = extractEduaiDiagramFence(content);
  const next = extractNextSection(content);

  // Nothing structural to reshape — keep original (Next? still relabeled later).
  if (!top && !step && !diagram) {
    return content;
  }

  const usedRanges: Array<{ start: number; end: number }> = [];
  if (top) usedRanges.push({ start: top.start, end: top.end });
  if (step) usedRanges.push({ start: step.start, end: step.end });
  if (diagram) usedRanges.push({ start: diagram.start, end: diagram.end });
  if (next) usedRanges.push({ start: next.start, end: next.end });

  const remainder = stripRanges(content, usedRanges)
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const stages = diagram ? parseEduaiDiagramBody(diagram.body).stages : [];

  let tldrBlock = completeTldrFromStages(top?.text ?? null, stages);
  if (!tldrBlock && stages.length > 0) {
    const synthesized = synthesizeTldrLines(stages);
    if (synthesized) tldrBlock = `**Top summary**\n${synthesized}`;
  }

  const stepText = completeStepLadderFromStages(step?.text ?? null, stages);

  const parts: string[] = [];
  if (stepText) parts.push(stepText);
  if (diagram) parts.push(diagram.text.trim());

  if (remainder) {
    // With Step ladder / diagram, drop orphan intro fluff (duplicate of TLDR).
    // Without them, keep the body explanation before the TLDR (#1060).
    const kept =
      stepText || diagram
        ? keepTrailingStructuralExtras(remainder)
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

/** Keep Sources / Connects / Quick check footers; drop orphan intro prose. */
function keepTrailingStructuralExtras(remainder: string): string {
  const lines = remainder.split("\n");
  const keepFrom = lines.findIndex((line) =>
    /^(Sources:|\*\*Sources|\*\*Connects to|Quick check)/i.test(line.trim()),
  );
  if (keepFrom < 0) return "";
  return lines.slice(keepFrom).join("\n").trim();
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
  if (existing && bulletCount >= stages.length) return existing;

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
 * catalog type (process-flow, hierarchy, compare). Preserves richer existing
 * step text when the stage label matches.
 */
function completeStepLadderFromStages(
  stepBlock: string | null,
  stages: EduaiDiagramStage[],
): string | null {
  const existing = stepBlock?.trim() || "";
  if (stages.length === 0) return existing || null;

  const numberedCount = countListItems(existing, /(?:^|\n)\s*\d+[.)]\s+/g);
  if (existing && numberedCount >= stages.length) return existing;

  const byLabel = new Map<string, string>();
  const byIndex = new Map<number, string>();
  for (const match of existing.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+(.+)/g)) {
    const idx = Number(match[1]);
    const body = (match[2] ?? "").trim();
    byIndex.set(idx, body);
    const bold = /^\*\*(.+?)\*\*/.exec(body);
    const label = bold?.[1] ?? body.split(/[:–—-]/, 1)[0] ?? body;
    byLabel.set(normalizeLabelKey(label), body);
  }

  const startMatch = /Start here:[^\n]*/i.exec(existing);
  const startLine =
    startMatch?.[0]?.trim() ?? `Start here: ${stages[0]?.label} (~2 min)`;

  const steps = stages.map((s, i) => {
    const prior =
      byLabel.get(normalizeLabelKey(s.label)) ?? byIndex.get(i + 1) ?? null;
    if (prior) {
      if (/^\*\*/.test(prior)) return `${i + 1}. ${prior}`;
      const stripped = prior.replace(
        new RegExp(`^${escapeRegExp(s.label)}\\s*:\\s*`, "i"),
        "",
      );
      return `${i + 1}. **${s.label}:** ${stripped}`;
    }
    return s.detail
      ? `${i + 1}. **${s.label}:** ${s.detail}`
      : `${i + 1}. **${s.label}:** ${s.label}`;
  });

  return normalizeGaps(["### Step ladder", startLine, ...steps].join("\n"));
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

function extractEduaiDiagramFence(
  content: string,
): { text: string; body: string; start: number; end: number } | null {
  const match = EDUAI_DIAGRAM_FENCE.exec(content);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const end = start + match[0].length;
  const endWithNl = content[end] === "\n" ? end + 1 : end;
  return {
    text: match[0],
    body: match[1] ?? "",
    start,
    end: endWithNl,
  };
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
