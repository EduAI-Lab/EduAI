import { randomUUID } from "crypto";
import { generateText, type LanguageModel } from "ai";
import {
  getProfileRequirements,
  type AdhdTurnProfile,
} from "~/lib/ai/adhd-turn-profile";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  ADHD_URGENCY_TERMS,
  computeAdhdResponseMetrics,
  hasSourcesFooter,
  hasStepLadderSection,
  isProfileStructuralPass,
  isRedirectTemplatePass,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withProfileStructuralPass,
  withStructuralPass,
  type AdhdStructuralCompliance,
} from "~/lib/ai/adhd-metrics";
import {
  ensureDiagramBeforeNext,
  hasEduaiDiagramFence,
  resolveAdhdAssistPolicyBlock,
} from "~/lib/ai/adhd-assist";
import { userRequestedDiagram, userRequestedStepRecall } from "~/lib/ai/adhd-turn-profile";

export const ADHD_OVERSIGHT_REWRITE_SYSTEM = `You are a formatting editor for ADHD Assist Mode chat responses.
Rewrite the draft to satisfy ALL structural rules without changing facts, numbers, or meaning.

REQUIRED MARKDOWN STRUCTURE:
1) First line MUST be exactly: **Top summary**
2) Then 1-3 bullet points that answer the learner's question.
3) If steps are needed, add a "### Step ladder" section with at most 5 numbered steps.
4) If a diagram is present, keep exactly one fenced eduai-diagram block (preferred) or ASCII text fence AFTER the body/steps and BEFORE **Next?**. Do not invent a diagram if the draft had none; do not split one diagram into multiple frames.
5) End with a standalone line: **Next?** <one short continuation offer>

LENGTH: Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.
Remove any urgency or time-pressure wording (e.g. "quickly", "fast", "hurry", "right away"); never rush the learner.
No emojis. No filler ("Great question!", "Certainly!").
Return ONLY the rewritten response.`;

const ADHD_OVERSIGHT_DIAGRAM_REQUIRED_ADDENDUM = `

DIAGRAM REQUIRED (learner asked for a visual):
- You MUST include exactly one markdown fenced code block tagged eduai-diagram.
- Known type ids: process-flow (default), gradient-descent, hierarchy, compare.
- Stored order MUST be: **Top summary** (concise 1-line-per-stage bullets) →
  ### Step ladder (EVERY diagram stage as a numbered step — not just step 1) →
  eduai-diagram fence → **Next?**.
- No freeform intro paragraph and no duplicate bullet list outside those sections.
- Stage names in Top summary, Step ladder, and the fence MUST match in order.
- Do NOT describe the diagram in prose instead of emitting the fence.
- Do NOT use a plain text/ASCII fence when eduai-diagram fits.`;

/** #1245: learner asked to revisit a specific numbered step from an earlier Step ladder. */
const ADHD_OVERSIGHT_STEP_LADDER_REQUIRED_ADDENDUM = `

STEP RECALL (learner asked to revisit/expand a specific step):
- You MUST include a "### Step ladder" section with at least one numbered
  step that re-explains the requested step in full — restate the action and
  its "why it matters" reason in fresh wording.
- Do NOT just repeat the earlier answer's wording for that step verbatim; a
  one-line copy is not an acceptable rewrite here.
- Keep the reply scoped to the requested step only.`;

const ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM = `You are a formatting editor for ADHD Assist Mode redirect responses.
The learner asked about a second topic while another is in progress.

RULES:
- Do NOT add a "Top summary" block.
- Keep a single-topic boundary: acknowledge the new topic and offer to return or switch.
- Do NOT explain, define, or state any fact about the second topic (#1313)
  — name it only, do not answer it. Remove any such content from the draft.
- Max 3 sentences total: acknowledge + (optional) restate the boundary +
  one forward offer.
- End with one clear forward continuation question if missing.
- Hard cap ${ADHD_CLARIFICATION_WORD_CAP} words.
- Remove any urgency or time-pressure wording ("quickly", "fast", "hurry"); never rush the learner.
- No emojis. No filler.
Return ONLY the rewritten response.`;

const DEFAULT_NEXT_OFFER = "Want me to continue with the next step?";
const DEFAULT_REDIRECT_NEXT =
  "Want to come back to the previous topic first, or switch now?";
/** Generic citation when tools/RAG ran — never invent chapter/page numbers. */
export const ADHD_OVERSIGHT_GENERIC_SOURCES =
  "Sources: Retrieved materials used this turn.";

export function buildOversightRewriteSystem(
  profile: AdhdTurnProfile,
  wordCap: number,
  options?: { requireDiagram?: boolean; requireStepLadder?: boolean },
): string {
  if (profile === "redirect") {
    return ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM;
  }
  let system: string;
  if (profile === "brief_clarification") {
    system = ADHD_OVERSIGHT_REWRITE_SYSTEM.replace(
      `Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.`,
      `Hard cap ${wordCap} words.`,
    );
  } else {
    system = ADHD_OVERSIGHT_REWRITE_SYSTEM.replace(
      `Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.`,
      `Hard cap ${wordCap} words.`,
    );
  }
  if (options?.requireDiagram) {
    system += ADHD_OVERSIGHT_DIAGRAM_REQUIRED_ADDENDUM;
  }
  if (options?.requireStepLadder) {
    system += ADHD_OVERSIGHT_STEP_LADDER_REQUIRED_ADDENDUM;
  }
  return system;
}

export type OversightMethod =
  | "none"
  | "deterministic"
  | "llm"
  | "llm_retry"
  | "forced_deterministic"
  | "llm_rejected"
  | "llm_failed";

/**
 * Output budget for the LLM rewrite. A compliant rewrite is at most `wordCap`
 * words, but a fixed 1024-token cap truncated rewrites of long drafts — and a
 * truncated rewrite fails validation (#714). Budget tokens from the word cap
 * with headroom for markdown anchors and tokenizer variance.
 */
export const ADHD_OVERSIGHT_REWRITE_TOKENS_PER_WORD = 6;
export const ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS = 1024;

export function resolveOversightRewriteMaxTokens(wordCap: number): number {
  const fromWordCap = Math.ceil(
    Math.max(0, wordCap) * ADHD_OVERSIGHT_REWRITE_TOKENS_PER_WORD,
  );
  return Math.max(ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS, fromWordCap);
}

export type OversightUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

export type AuditAndMaybeRewriteResult = {
  text: string;
  rewritten: boolean;
  method: OversightMethod;
  beforeMetrics: AdhdStructuralCompliance & { profileStructuralPass?: boolean };
  afterMetrics: AdhdStructuralCompliance & { profileStructuralPass?: boolean };
  oversightDurationMs: number;
  oversightUsage: OversightUsage | null;
};

export function isAdhdOversightEnabled(): boolean {
  const raw = process.env.ADHD_ASSIST_OVERSIGHT?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/** Skip oversight when the model produced no readable assistant prose. */
export function isOversightEligibleDraft(draft: string): boolean {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return false;
  return /[a-zA-Z]/.test(trimmed);
}

export function emptyOversightAuditResult(): AuditAndMaybeRewriteResult {
  const metrics = withStructuralPass(computeAdhdResponseMetrics(""));
  return {
    text: "",
    rewritten: false,
    method: "none",
    beforeMetrics: metrics,
    afterMetrics: metrics,
    oversightDurationMs: 0,
    oversightUsage: null,
  };
}

function lastNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/** Policy §3 Next? / §5 redirect examples use forward offers, not comprehension checks. */
const FORWARD_CONTINUATION_OFFER =
  /^(?:want(?:\s+to|\s+me\b)|ready to|would you like|should we|shall we|need (?:a|to|help)|or switch|continue with|keep going|move on)/i;

export function isForwardContinuationOffer(line: string): boolean {
  const trimmed = (line ?? "").trim();
  if (!trimmed.endsWith("?")) return false;
  if (/^Next\?\s/i.test(trimmed)) {
    const prompt = trimmed.replace(/^Next\?\s*/i, "").trim();
    return prompt.length > 0 && FORWARD_CONTINUATION_OFFER.test(prompt);
  }
  return FORWARD_CONTINUATION_OFFER.test(trimmed);
}

type InlineNextMatch = { body: string; prompt: string };

/** Match the last inline `Next?` prompt so quoted mid-text anchors are not stripped. */
export function findLastInlineNextMatch(text: string): InlineNextMatch | null {
  let bestIndex = -1;
  let bestPrompt: string | null = null;

  const scan = (pattern: RegExp) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const prompt = match[1]?.trim();
      if (!prompt) continue;
      const index = match.index;
      if (index >= bestIndex) {
        bestIndex = index;
        bestPrompt = prompt;
      }
    }
  };

  scan(/\nNext\?\s+(.+)/gi);
  scan(/^Next\?\s+(.+)$/gim);

  if (bestPrompt === null || bestIndex < 0) return null;
  return {
    body: text.slice(0, bestIndex).trimEnd(),
    prompt: bestPrompt,
  };
}

/** Prefer an existing trailing question (e.g. redirect prompts) over generic filler. */
export function extractNextPromptCandidate(text: string): string | null {
  const last = lastNonEmptyLine(text);
  if (!last) return null;
  if (/^Next\?\s/i.test(last)) {
    const prompt = last.replace(/^Next\?\s*/i, "").trim();
    return prompt.length > 0 && isForwardContinuationOffer(last) ? prompt : null;
  }
  if (isForwardContinuationOffer(last)) return last;
  return null;
}

/**
 * Promote an inline or trailing continuation prompt to the required **Next?** anchor.
 * Returns null when no candidate exists (caller should try LLM rewrite or force wrap).
 */
export function applyNextLineAnchor(text: string): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const inline = findLastInlineNextMatch(trimmed);
  if (inline) {
    const inlineLine = `Next? ${inline.prompt}`;
    if (isForwardContinuationOffer(inlineLine)) {
      return `${inline.body}\n\n**Next?** ${inline.prompt}`;
    }
  }

  const candidate = extractNextPromptCandidate(trimmed);
  if (!candidate) return null;

  let body = trimmed;
  if (body.endsWith(candidate)) {
    body = body.slice(0, body.length - candidate.length).trimEnd();
  }
  return `${body}\n\n**Next?** ${candidate}`;
}

/**
 * Normalize common Top summary / Next? variants so detectors and learners see
 * the canonical anchors (e.g. `* Top summary` → `**Top summary**`).
 */
export function normalizeAdhdStructuralAnchors(text: string): string {
  let t = (text ?? "").trim();
  if (!t) return t;

  const leadingOk = t.replace(/^\s{0,2}/, "").startsWith("**Top summary**");
  if (!leadingOk) {
    const leading = t.match(
      /^(\s{0,2})(?:\*{1,2}\s*)?Top\s+summary(?:\*{1,2})?\s*:?\s*\n?/i,
    );
    if (leading) {
      t = `**Top summary**\n${t.slice(leading[0].length)}`;
    }
  }

  const lines = t.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:\*{0,2})\s*Next\?\s*(?:\*{0,2})\s*(.*)$/i);
    if (m && !/^\*\*Next\?\*\*/.test(line)) {
      const prompt = (m[1] ?? "").trim();
      // Only promote forward offers — never bold a comprehension-check "Next?".
      if (prompt && isForwardContinuationOffer(`Next? ${prompt}`)) {
        lines[i] = `**Next?** ${prompt}`;
      }
    }
    break;
  }
  return lines.join("\n").trim();
}

/** Strip STYLE-banned urgency terms without inventing new pedagogy. */
export function stripUrgencyLanguage(text: string): string {
  let t = text ?? "";
  const sorted = [...ADHD_URGENCY_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  return t
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function insertBeforeNext(text: string, block: string): string {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\*\*Next\?\*\*/i.test(lines[i].trim())) {
      const before = lines.slice(0, i).join("\n").trimEnd();
      const after = lines.slice(i).join("\n");
      return `${before}\n\n${block}\n\n${after}`.trim();
    }
  }
  return `${trimmed}\n\n${block}`.trim();
}

/** Count whitespace-separated words in a string. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Clip body text to a word budget while preserving newlines and whole fenced
 * blocks. Never emits a partial ``` fence — take the whole block or skip it.
 */
function clipBodyPreservingMarkdown(body: string, wordBudget: number): string {
  if (!body || wordBudget <= 0) return "";
  if (countWords(body) <= wordBudget) return body;

  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let used = 0;
  let i = 0;

  while (i < lines.length && used < wordBudget) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      const fenceLines = [line];
      let j = i + 1;
      while (j < lines.length) {
        fenceLines.push(lines[j]);
        if (/^```/.test(lines[j].trim())) break;
        j += 1;
      }
      const closed = j < lines.length && /^```/.test(lines[j].trim());
      const fenceText = fenceLines.join("\n");
      const fenceWords = countWords(fenceText);
      // Incomplete fence (no closer): drop it rather than emit broken Markdown.
      if (closed && used + fenceWords <= wordBudget) {
        out.push(...fenceLines);
        used += fenceWords;
      }
      i = closed ? j + 1 : lines.length;
      continue;
    }

    const lineWords = line.split(/\s+/).filter(Boolean);
    if (lineWords.length === 0) {
      out.push(line);
      i += 1;
      continue;
    }
    if (used + lineWords.length <= wordBudget) {
      out.push(line);
      used += lineWords.length;
      i += 1;
      continue;
    }
    const remaining = wordBudget - used;
    if (remaining > 0) {
      out.push(lineWords.slice(0, remaining).join(" "));
      used = wordBudget;
    }
    break;
  }

  return out.join("\n").trim();
}

const MIN_BODY_WORDS_WHEN_FITTING = 20;

/**
 * Bound the Sources:/Next? tail so it can never push the response over
 * `wordCap`. Oversized citation footers are replaced with the short generic
 * Sources line; if even that cannot fit with **Next?**, Sources is dropped.
 */
function boundStructuralTail(
  sourcesBlock: string,
  nextBlock: string,
  wordCap: number,
): string {
  const next = (nextBlock ?? "").trim();
  const nextWords = next ? countWords(next) : 0;
  let sources = (sourcesBlock ?? "").trim();

  if (sources) {
    const genericWords = countWords(ADHD_OVERSIGHT_GENERIC_SOURCES);
    // Prefer leaving room for a short body when the cap allows it.
    const sourcesBudget = Math.max(
      0,
      wordCap - nextWords - MIN_BODY_WORDS_WHEN_FITTING,
    );
    if (
      countWords(sources) > sourcesBudget &&
      sourcesBudget >= genericWords
    ) {
      sources = ADHD_OVERSIGHT_GENERIC_SOURCES;
    } else if (countWords(sources) > Math.max(0, wordCap - nextWords)) {
      // Still too large even without a body reserve — swap or drop.
      if (genericWords <= Math.max(0, wordCap - nextWords)) {
        sources = ADHD_OVERSIGHT_GENERIC_SOURCES;
      } else {
        sources = "";
      }
    }
  }

  let tail = [sources, next].filter(Boolean).join("\n\n");
  if (countWords(tail) > wordCap) {
    // Last resort: keep **Next?** only (or clip if somehow still over).
    if (next && nextWords <= wordCap) return next;
    if (next) {
      return next.split(/\s+/).filter(Boolean).slice(0, wordCap).join(" ");
    }
    return ADHD_OVERSIGHT_GENERIC_SOURCES.split(/\s+/)
      .filter(Boolean)
      .slice(0, wordCap)
      .join(" ");
  }
  return tail;
}

/**
 * Keep trailing **Next?** (and optional Sources) when trimming to the word cap.
 * Preserves Markdown structure (newlines + fenced blocks) in the body.
 * Never returns more than `wordCap` words — oversized Sources footers are
 * replaced with the short generic citation line rather than reserving the
 * full footer and still granting a minimum body (which previously overran).
 */
export function truncateToWordCap(text: string, wordCap: number): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return trimmed;
  if (countWords(trimmed) <= wordCap) return trimmed;

  const lines = trimmed.split(/\r?\n/);
  let nextIdx = -1;
  let sourcesIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (nextIdx < 0 && /^\*\*Next\?\*\*/i.test(line)) nextIdx = i;
    if (sourcesIdx < 0 && /^(?:\*\*sources\*?\*?|sources:)/i.test(line)) {
      sourcesIdx = i;
    }
    if (nextIdx >= 0 && sourcesIdx >= 0) break;
  }

  const nextBlock =
    nextIdx >= 0 ? lines.slice(nextIdx).join("\n").trim() : "";
  const sourcesEnd =
    sourcesIdx >= 0
      ? nextIdx >= 0 && nextIdx > sourcesIdx
        ? nextIdx
        : lines.length
      : -1;
  const sourcesBlock =
    sourcesIdx >= 0
      ? lines.slice(sourcesIdx, sourcesEnd).join("\n").trim()
      : "";
  const bodyEnd =
    sourcesIdx >= 0 && (nextIdx < 0 || sourcesIdx < nextIdx)
      ? sourcesIdx
      : nextIdx >= 0
        ? nextIdx
        : lines.length;
  const body = lines.slice(0, bodyEnd).join("\n").trim();

  const tail = boundStructuralTail(sourcesBlock, nextBlock, wordCap);
  const tailWords = tail ? countWords(tail) : 0;
  // Never force a body minimum that would exceed the cap.
  const bodyBudget = Math.max(0, wordCap - tailWords);
  const clippedBody = clipBodyPreservingMarkdown(body, bodyBudget);
  const result = (tail ? `${clippedBody}\n\n${tail}` : clippedBody).trim();
  // Final safety: hard-clip if anything still overran (should be rare).
  if (countWords(result) <= wordCap) return result;
  return result.split(/\s+/).filter(Boolean).slice(0, wordCap).join(" ");
}

/**
 * Last-resort structural wrap: never ship a tutoring/redirect draft that fails
 * the measurable constitution after LLM reject/fail (Track B harden).
 */
export function forceDeterministicCompliance(
  draft: string,
  options: {
    wordCap: number;
    profile: AdhdTurnProfile;
    requireDiagram?: boolean;
    expectSources?: boolean;
    userText?: string;
  },
): string {
  const req = getProfileRequirements(options.profile);
  let text = normalizeAdhdStructuralAnchors(draft);
  text = stripUrgencyLanguage(text);

  if (options.requireDiagram && !hasEduaiDiagramFence(text)) {
    text = ensureDiagramBeforeNext(text, { userText: options.userText });
  }

  if (req.expectRedirectTemplate) {
    let withNext = applyNextLineAnchor(text);
    if (!withNext) {
      withNext = `${text}\n\n**Next?** ${DEFAULT_REDIRECT_NEXT}`;
    }
    text = truncateToWordCap(withNext, options.wordCap);
    return normalizeAdhdStructuralAnchors(text);
  }

  if (req.expectTopSummary) {
    const leading = text.replace(/^\s{0,2}/, "");
    if (!leading.startsWith("**Top summary**")) {
      text = `**Top summary**\n${text}`;
    }
  }

  if (req.expectNextLine) {
    const metrics = computeAdhdResponseMetrics(text, {
      wordCap: options.wordCap,
    });
    if (!metrics.nextLine) {
      const withNext = applyNextLineAnchor(text);
      text = withNext ?? `${text}\n\n**Next?** ${DEFAULT_NEXT_OFFER}`;
    }
  }

  if (options.expectSources && !hasSourcesFooter(text)) {
    text = insertBeforeNext(text, ADHD_OVERSIGHT_GENERIC_SOURCES);
  }

  text = truncateToWordCap(text, options.wordCap);

  // Truncation can drop anchors or a diagram fence — revalidate requirements.
  if (options.requireDiagram && !hasEduaiDiagramFence(text)) {
    text = ensureDiagramBeforeNext(text, { userText: options.userText });
    text = truncateToWordCap(text, options.wordCap);
  }
  if (req.expectNextLine) {
    const after = computeAdhdResponseMetrics(text, { wordCap: options.wordCap });
    if (!after.nextLine) {
      text = `${text}\n\n**Next?** ${DEFAULT_NEXT_OFFER}`;
      text = truncateToWordCap(text, options.wordCap);
    }
  }
  if (req.expectTopSummary) {
    const leading = text.replace(/^\s{0,2}/, "");
    if (!leading.startsWith("**Top summary**")) {
      text = `**Top summary**\n${text}`;
      text = truncateToWordCap(text, options.wordCap);
    }
  }
  if (options.expectSources && !hasSourcesFooter(text)) {
    text = insertBeforeNext(text, ADHD_OVERSIGHT_GENERIC_SOURCES);
    text = truncateToWordCap(text, options.wordCap);
  }

  text = normalizeAdhdStructuralAnchors(text);
  // Guaranteed under-cap after any re-inserted anchors / Sources.
  if (countWords(text) > options.wordCap) {
    text = truncateToWordCap(text, options.wordCap);
    text = normalizeAdhdStructuralAnchors(text);
  }
  return text;
}

function passesProfileStructure(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
): boolean {
  return isProfileStructuralPass(metrics, profile, text);
}

function contentOk(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
  options?: { requireDiagram?: boolean; expectSources?: boolean; requireStepLadder?: boolean },
): boolean {
  if (!passesProfileStructure(metrics, profile, text)) return false;
  if (!metrics.noUrgency) return false;
  if (options?.requireDiagram && !hasEduaiDiagramFence(text)) return false;
  if (options?.expectSources && !metrics.hasSources) return false;
  if (options?.requireStepLadder && !metrics.stepLadder) return false;
  return true;
}

/** Explain why a candidate rewrite failed acceptance (fed into one retry). */
export function describeOversightRejectReasons(
  metrics: AdhdStructuralCompliance & { profileStructuralPass: boolean },
  profile: AdhdTurnProfile,
  text: string,
  options?: { requireDiagram?: boolean; expectSources?: boolean; requireStepLadder?: boolean },
): string[] {
  const reasons: string[] = [];
  const req = getProfileRequirements(profile);
  if (!metrics.underCap) {
    reasons.push(`over word cap (${metrics.wordCount} > allowed)`);
  }
  if (req.expectTopSummary && !metrics.topSummary) {
    reasons.push("missing leading **Top summary**");
  }
  if (req.expectNextLine && !metrics.nextLine) {
    reasons.push("missing trailing **Next?**");
  }
  if (req.expectRedirectTemplate && !isRedirectTemplatePass(metrics, text)) {
    reasons.push("redirect template not met (one-topic boundary + forward offer)");
  }
  if (!metrics.noUrgency) {
    reasons.push("urgency / time-pressure wording still present");
  }
  if (options?.requireDiagram && !hasEduaiDiagramFence(text)) {
    reasons.push("missing eduai-diagram fence");
  }
  if (options?.expectSources && !metrics.hasSources) {
    reasons.push("missing Sources footer after tools/RAG ran");
  }
  if (options?.requireStepLadder && !metrics.stepLadder) {
    reasons.push(
      "learner asked to revisit a specific step — reply must include a real ### Step ladder " +
        "re-explanation of that step (with a why-it-matters clause), not a one-line copy of the earlier wording",
    );
  }
  if (reasons.length === 0 && !metrics.profileStructuralPass) {
    reasons.push("profile structural pass failed");
  }
  return reasons;
}

function buildOversightUserPrompt(args: {
  draft: string;
  userText?: string;
  profile: AdhdTurnProfile;
  requireDiagram: boolean;
  expectSources: boolean;
  requireStepLadder?: boolean;
  rejectReasons?: string[];
}): string {
  const learner = (args.userText ?? "").trim() || "(unknown)";
  const policySlice = resolveAdhdAssistPolicyBlock(args.profile);
  const parts: string[] = [
    `LEARNER MESSAGE:\n${learner}`,
    `\nPROFILE: ${args.profile}`,
    `\nTEACHER POLICY SLICE (follow structure/style; do not invent new facts):\n${policySlice}`,
  ];
  if (args.expectSources) {
    parts.push(
      `\nCITATION: Tools/RAG ran this turn. End with a Sources footer. If specific chapter/page/slide is unknown, use exactly:\n${ADHD_OVERSIGHT_GENERIC_SOURCES}`,
    );
  }
  if (args.rejectReasons?.length) {
    parts.push(
      `\nPREVIOUS REWRITE WAS REJECTED. Fix ALL of these:\n- ${args.rejectReasons.join("\n- ")}`,
    );
  }
  if (args.requireDiagram) {
    parts.push(
      `\nThe learner asked for a diagram. Rewrite so the reply includes one eduai-diagram fence with topic-specific stage labels (type: process-flow, gradient-descent, hierarchy, or compare — default process-flow). Stages must match Top summary / Step ladder names.`,
    );
  }
  if (args.requireStepLadder) {
    parts.push(
      `\nThe learner asked to revisit a specific numbered step from an earlier plan. Rewrite so the reply includes a "### Step ladder" section that re-explains that step in full (fresh wording, plus a why-it-matters clause) — do not just repeat the earlier answer's line for that step verbatim.`,
    );
  }
  parts.push(`\nDRAFT TO REWRITE:\n\n${args.draft}`);
  return parts.join("\n");
}

function mergeUsage(
  a: OversightUsage | null | undefined,
  b: OversightUsage | null | undefined,
): OversightUsage | null {
  if (!a && !b) return null;
  return {
    promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0) || undefined,
    completionTokens:
      (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0) || undefined,
  };
}

/** Fast path: fix missing literal anchors without an LLM call. */
export function tryDeterministicStructuralFix(
  draft: string,
  options?: {
    wordCap?: number;
    profile?: AdhdTurnProfile;
    expectSources?: boolean;
    requireStepLadder?: boolean;
  },
): string | null {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = options?.profile;
  const trimmed = normalizeAdhdStructuralAnchors(draft);
  if (!trimmed) return null;

  // A missing Step ladder can't be fixed deterministically (there is no real
  // step content to insert) — only an LLM rewrite can regenerate it, so bail
  // out here rather than ship a draft that passes every other check while
  // still being the thin, copy-pasted fragment #1245 is about.
  if (options?.requireStepLadder) {
    const metrics = computeAdhdResponseMetrics(trimmed, { wordCap });
    if (!metrics.stepLadder) return null;
  }

  if (profile) {
    const before = withProfileStructuralPass(
      computeAdhdResponseMetrics(trimmed, { wordCap }),
      profile,
      trimmed,
    );
    if (
      before.profileStructuralPass &&
      (!options?.expectSources || before.hasSources)
    ) {
      return trimmed;
    }

    if (getProfileRequirements(profile).expectRedirectTemplate) {
      const withNext = applyNextLineAnchor(trimmed);
      if (withNext) {
        const after = withProfileStructuralPass(
          computeAdhdResponseMetrics(withNext, { wordCap }),
          profile,
          withNext,
        );
        if (after.profileStructuralPass) return withNext;
      }
      return null;
    }

    if (!getProfileRequirements(profile).expectTopSummary) {
      return null;
    }
  }

  const before = computeAdhdResponseMetrics(trimmed, { wordCap });
  if (
    isStructuralCompliancePass(before) &&
    (!options?.expectSources || before.hasSources)
  ) {
    return trimmed;
  }

  let fixed = trimmed;

  if (!before.topSummary) {
    fixed = `**Top summary**\n${fixed}`;
  }

  if (!before.nextLine) {
    const withNext = applyNextLineAnchor(fixed);
    if (!withNext) return null;
    fixed = withNext;
  }

  if (options?.expectSources && !hasSourcesFooter(fixed)) {
    fixed = insertBeforeNext(fixed, ADHD_OVERSIGHT_GENERIC_SOURCES);
  }

  const after = computeAdhdResponseMetrics(fixed, { wordCap });
  return isStructuralCompliancePass(after) &&
    (!options?.expectSources || after.hasSources)
    ? fixed
    : null;
}

export async function auditAndMaybeRewrite(args: {
  draft: string;
  model: LanguageModel;
  wordCap?: number;
  profile?: AdhdTurnProfile;
  userText?: string;
  priorAssistantText?: string;
  /** When true, require a Sources footer (tools/RAG ran). Never invent page numbers. */
  toolsUsed?: boolean;
}): Promise<AuditAndMaybeRewriteResult> {
  const wordCap = args.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = args.profile ?? "full_tutoring";
  const rawDraft = (args.draft ?? "").trim();
  const trimmed = normalizeAdhdStructuralAnchors(rawDraft);
  const profileReq = getProfileRequirements(profile);
  const requireDiagram =
    userRequestedDiagram(args.userText) && !hasEduaiDiagramFence(trimmed);
  const expectSources = Boolean(args.toolsUsed);
  // #1245: a step-recall request must get a real Step ladder re-explanation,
  // not just a bare Top summary / Next? shell around a copy-pasted fragment.
  // Only full_tutoring's policy block describes Step ladder rules at all.
  const requireStepLadder =
    profile === "full_tutoring" &&
    userRequestedStepRecall({
      userText: args.userText,
      priorAssistantText: args.priorAssistantText,
    }) &&
    !hasStepLadderSection(trimmed);
  const diagramOpts = { userText: args.userText };
  const gateOpts = { requireDiagram, expectSources, requireStepLadder };

  const beforeMetrics = withProfileStructuralPass(
    computeAdhdResponseMetrics(trimmed, { wordCap }),
    profile,
    trimmed,
  );

  if (!rawDraft) {
    return emptyOversightAuditResult();
  }

  if (!profileReq.runDean) {
    if (requireDiagram) {
      const withDiagram = ensureDiagramBeforeNext(trimmed, diagramOpts);
      return {
        text: withDiagram,
        rewritten: withDiagram !== rawDraft,
        method: withDiagram !== rawDraft ? "deterministic" : "none",
        beforeMetrics,
        afterMetrics: withProfileStructuralPass(
          computeAdhdResponseMetrics(withDiagram, { wordCap }),
          profile,
          withDiagram,
        ),
        oversightDurationMs: 0,
        oversightUsage: null,
      };
    }
    return {
      text: trimmed !== rawDraft ? trimmed : rawDraft,
      rewritten: trimmed !== rawDraft,
      method: trimmed !== rawDraft ? "deterministic" : "none",
      beforeMetrics,
      afterMetrics: withProfileStructuralPass(
        computeAdhdResponseMetrics(trimmed, { wordCap }),
        profile,
        trimmed,
      ),
      oversightDurationMs: 0,
      oversightUsage: null,
    };
  }

  if (!isOversightEligibleDraft(trimmed)) {
    return {
      text: rawDraft,
      rewritten: false,
      method: "none",
      beforeMetrics,
      afterMetrics: beforeMetrics,
      oversightDurationMs: 0,
      oversightUsage: null,
    };
  }

  if (!requireDiagram && contentOk(beforeMetrics, profile, trimmed, gateOpts)) {
    return {
      text: trimmed,
      rewritten: trimmed !== rawDraft,
      method: trimmed !== rawDraft ? "deterministic" : "none",
      beforeMetrics,
      afterMetrics: beforeMetrics,
      oversightDurationMs: 0,
      oversightUsage: null,
    };
  }

  const deterministic = tryDeterministicStructuralFix(trimmed, {
    wordCap,
    profile,
    expectSources,
    requireStepLadder,
  });
  if (deterministic && !requireDiagram) {
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(deterministic, { wordCap }),
      profile,
      deterministic,
    );
    if (contentOk(afterMetrics, profile, deterministic, gateOpts)) {
      return {
        text: deterministic,
        rewritten: true,
        method: "deterministic",
        beforeMetrics,
        afterMetrics,
        oversightDurationMs: 0,
        oversightUsage: null,
      };
    }
  }

  const oversightStartedAt = Date.now();
  let usageAcc: OversightUsage | null = null;

  // Accept only full contentOk compliance — never ship a rewrite that merely
  // improves the structural score while still missing anchors (e.g. **Next?**).
  const acceptLlm = (llmText: string): boolean => {
    if (!llmText) return false;
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(llmText, { wordCap }),
      profile,
      llmText,
    );
    return afterMetrics.underCap && contentOk(afterMetrics, profile, llmText, gateOpts);
  };

  const runLlm = async (rejectReasons?: string[]) => {
    const { text: rewritten, usage } = await generateText({
      model: args.model,
      temperature: 0.2,
      maxTokens: resolveOversightRewriteMaxTokens(wordCap),
      system: buildOversightRewriteSystem(profile, wordCap, {
        requireDiagram,
        requireStepLadder,
      }),
      prompt: buildOversightUserPrompt({
        draft: trimmed,
        userText: args.userText,
        profile,
        requireDiagram,
        expectSources,
        requireStepLadder,
        rejectReasons,
      }),
    });
    usageAcc = mergeUsage(usageAcc, {
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    });
    let llmText = (rewritten ?? "").trim();
    if (requireDiagram && llmText && !hasEduaiDiagramFence(llmText)) {
      llmText = ensureDiagramBeforeNext(llmText, diagramOpts);
    }
    llmText = normalizeAdhdStructuralAnchors(llmText);
    return llmText;
  };

  try {
    let llmText = await runLlm();
    let method: OversightMethod = "llm";

    if (!acceptLlm(llmText)) {
      const reasons = describeOversightRejectReasons(
        withProfileStructuralPass(
          computeAdhdResponseMetrics(llmText || trimmed, { wordCap }),
          profile,
          llmText || trimmed,
        ),
        profile,
        llmText || trimmed,
        gateOpts,
      );
      llmText = await runLlm(reasons);
      method = "llm_retry";
    }

    if (acceptLlm(llmText)) {
      const afterMetrics = withProfileStructuralPass(
        computeAdhdResponseMetrics(llmText, { wordCap }),
        profile,
        llmText,
      );
      return {
        text: llmText,
        rewritten: true,
        method,
        beforeMetrics,
        afterMetrics,
        oversightDurationMs: Date.now() - oversightStartedAt,
        oversightUsage: usageAcc,
      };
    }

    // Track B: never fail-open with a non-compliant tutoring draft.
    const forcedResult = finalizeForcedDeterministic({
      draft: trimmed,
      rawDraft,
      wordCap,
      profile,
      requireDiagram,
      expectSources,
      requireStepLadder,
      userText: args.userText,
      beforeMetrics,
      oversightStartedAt,
      oversightUsage: usageAcc,
      gateOpts,
    });
    return forcedResult;
  } catch (error) {
    console.error("[adhd-oversight] LLM rewrite failed", error);
    return finalizeForcedDeterministic({
      draft: trimmed,
      rawDraft,
      wordCap,
      profile,
      requireDiagram,
      expectSources,
      requireStepLadder,
      userText: args.userText,
      beforeMetrics,
      oversightStartedAt,
      oversightUsage: usageAcc,
      gateOpts,
    });
  }
}

/**
 * Build the forced_deterministic result and refuse to return it unless it is
 * under the word cap and passes contentOk (anchors / urgency / diagram /
 * Sources). If the first wrap still fails, rebuild a minimal skeleton.
 */
function finalizeForcedDeterministic(args: {
  draft: string;
  rawDraft: string;
  wordCap: number;
  profile: AdhdTurnProfile;
  requireDiagram?: boolean;
  expectSources?: boolean;
  requireStepLadder?: boolean;
  userText?: string;
  beforeMetrics: AdhdStructuralCompliance & { profileStructuralPass?: boolean };
  oversightStartedAt: number;
  oversightUsage: OversightUsage | null;
  gateOpts: { requireDiagram?: boolean; expectSources?: boolean; requireStepLadder?: boolean };
}): AuditAndMaybeRewriteResult {
  const wrapOpts = {
    wordCap: args.wordCap,
    profile: args.profile,
    requireDiagram: args.requireDiagram,
    expectSources: args.expectSources,
    userText: args.userText,
  };

  let forced = forceDeterministicCompliance(args.draft, wrapOpts);
  let forcedMetrics = withProfileStructuralPass(
    computeAdhdResponseMetrics(forced, { wordCap: args.wordCap }),
    args.profile,
    forced,
  );

  const forcedOk =
    forcedMetrics.underCap &&
    contentOk(forcedMetrics, args.profile, forced, args.gateOpts);

  if (!forcedOk) {
    // Minimal under-cap skeleton — prefer compliance over preserving draft prose.
    const req = getProfileRequirements(args.profile);
    const parts: string[] = [];
    if (req.expectTopSummary) {
      parts.push("**Top summary**", "- See the question above.");
    } else {
      parts.push("One topic at a time — happy to switch or return.");
    }
    if (args.requireStepLadder) {
      parts.push(
        "### Step ladder",
        "1. Revisit that step — why it matters: keeps the plan in order so you don't lose your place.",
      );
    }
    if (args.requireDiagram) {
      parts.push(
        [
          "```eduai-diagram",
          "process-flow",
          "title: Steps",
          "One: First",
          "Two: Second",
          "```",
        ].join("\n"),
      );
    }
    if (args.expectSources) {
      parts.push(ADHD_OVERSIGHT_GENERIC_SOURCES);
    }
    if (req.expectNextLine || req.expectRedirectTemplate) {
      parts.push(
        `**Next?** ${
          req.expectRedirectTemplate ? DEFAULT_REDIRECT_NEXT : DEFAULT_NEXT_OFFER
        }`,
      );
    }
    forced = truncateToWordCap(parts.filter(Boolean).join("\n\n"), args.wordCap);
    forced = normalizeAdhdStructuralAnchors(forced);
    forcedMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(forced, { wordCap: args.wordCap }),
      args.profile,
      forced,
    );
  }

  return {
    text: forced,
    rewritten: forced !== args.rawDraft,
    method: "forced_deterministic",
    beforeMetrics: args.beforeMetrics,
    afterMetrics: forcedMetrics,
    oversightDurationMs: Date.now() - args.oversightStartedAt,
    oversightUsage: args.oversightUsage,
  };
}

export type OverseenAssistantMessage = {
  id?: string;
  role: string;
  content: unknown;
};

export function buildOverseenAssistantMessagesToPersist(
  responseMessages: OverseenAssistantMessage[] | undefined,
  overseenText: string,
  options?: { generateId?: () => string },
): OverseenAssistantMessage[] {
  const generateId = options?.generateId ?? randomUUID;

  if (responseMessages?.length) {
    const assistantMessages = responseMessages.filter(
      (message) => message.role === "assistant",
    );
    if (assistantMessages.length > 0 && overseenText) {
      return assistantMessages.map((message, index) =>
        index === assistantMessages.length - 1
          ? { ...message, content: overseenText }
          : message,
      );
    }
    return assistantMessages;
  }
  if (overseenText) {
    return [{ id: generateId(), role: "assistant", content: overseenText }];
  }
  return [];
}

/** @deprecated Use resolveAdhdResponseWordCap from adhd-metrics.ts */
export function resolveAdhdWordCap(userText?: string): number {
  return resolveAdhdResponseWordCap(userText);
}
