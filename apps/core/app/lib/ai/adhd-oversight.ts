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
import { userRequestedDiagram } from "~/lib/ai/adhd-turn-profile";

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

const ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM = `You are a formatting editor for ADHD Assist Mode redirect responses.
The learner asked about a second topic while another is in progress.

RULES:
- Do NOT add a "Top summary" block.
- Keep a single-topic boundary: acknowledge the new topic and offer to return or switch.
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
  options?: { requireDiagram?: boolean },
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
  beforeMetrics: AdhdStructuralCompliance;
  afterMetrics: AdhdStructuralCompliance;
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

/**
 * Keep trailing **Next?** (and optional Sources) when trimming to the word cap.
 */
export function truncateToWordCap(text: string, wordCap: number): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return trimmed;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= wordCap) return trimmed;

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

  const tailStart =
    sourcesIdx >= 0 && (nextIdx < 0 || sourcesIdx < nextIdx)
      ? sourcesIdx
      : nextIdx;
  const tail =
    tailStart >= 0 ? lines.slice(tailStart).join("\n").trim() : "";
  const body = (tailStart >= 0 ? lines.slice(0, tailStart) : lines)
    .join("\n")
    .trim();
  const tailWords = tail ? tail.split(/\s+/).filter(Boolean).length : 0;
  const bodyBudget = Math.max(20, wordCap - tailWords);
  const bodyWords = body.split(/\s+/).filter(Boolean);
  const clippedBody = bodyWords.slice(0, bodyBudget).join(" ");
  return (tail ? `${clippedBody}\n\n${tail}` : clippedBody).trim();
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

  // Truncation can drop the Next? line if the body was empty — re-assert anchors.
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

  return normalizeAdhdStructuralAnchors(text);
}

function profileStructuralScore(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
): number {
  let score = metrics.underCap ? 1 : 0;
  const req = getProfileRequirements(profile);
  if (req.expectTopSummary) score += metrics.topSummary ? 1 : 0;
  if (req.expectNextLine) score += metrics.nextLine ? 1 : 0;
  if (req.expectRedirectTemplate && isRedirectTemplatePass(metrics, text)) {
    score += 2;
  }
  return score;
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
  options?: { requireDiagram?: boolean; expectSources?: boolean },
): boolean {
  if (!passesProfileStructure(metrics, profile, text)) return false;
  if (!metrics.noUrgency) return false;
  if (options?.requireDiagram && !hasEduaiDiagramFence(text)) return false;
  if (options?.expectSources && !metrics.hasSources) return false;
  return true;
}

/** Explain why a candidate rewrite failed acceptance (fed into one retry). */
export function describeOversightRejectReasons(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
  options?: { requireDiagram?: boolean; expectSources?: boolean },
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
  },
): string | null {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = options?.profile;
  const trimmed = normalizeAdhdStructuralAnchors(draft);
  if (!trimmed) return null;

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
  const diagramOpts = { userText: args.userText };
  const gateOpts = { requireDiagram, expectSources };

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

  const acceptLlm = (llmText: string): boolean => {
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(llmText, { wordCap }),
      profile,
      llmText,
    );
    const urgencyWasProblem = !beforeMetrics.noUrgency;
    const diagramOk = !requireDiagram || hasEduaiDiagramFence(llmText);
    const sourcesOk = !expectSources || afterMetrics.hasSources;
    const structuralOk =
      afterMetrics.profileStructuralPass ||
      profileStructuralScore(afterMetrics, profile, llmText) >
        profileStructuralScore(beforeMetrics, profile, trimmed);
    return (
      llmText.length > 0 &&
      afterMetrics.underCap &&
      diagramOk &&
      sourcesOk &&
      (!urgencyWasProblem || afterMetrics.noUrgency) &&
      structuralOk
    );
  };

  const runLlm = async (rejectReasons?: string[]) => {
    const { text: rewritten, usage } = await generateText({
      model: args.model,
      temperature: 0.2,
      maxTokens: resolveOversightRewriteMaxTokens(wordCap),
      system: buildOversightRewriteSystem(profile, wordCap, { requireDiagram }),
      prompt: buildOversightUserPrompt({
        draft: trimmed,
        userText: args.userText,
        profile,
        requireDiagram,
        expectSources,
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
    const forced = forceDeterministicCompliance(trimmed, {
      wordCap,
      profile,
      requireDiagram,
      expectSources,
      userText: args.userText,
    });
    const forcedMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(forced, { wordCap }),
      profile,
      forced,
    );
    return {
      text: forced,
      rewritten: forced !== rawDraft,
      method: "forced_deterministic",
      beforeMetrics,
      afterMetrics: forcedMetrics,
      oversightDurationMs: Date.now() - oversightStartedAt,
      oversightUsage: usageAcc,
    };
  } catch (error) {
    console.error("[adhd-oversight] LLM rewrite failed", error);
    const forced = forceDeterministicCompliance(trimmed, {
      wordCap,
      profile,
      requireDiagram,
      expectSources,
      userText: args.userText,
    });
    return {
      text: forced,
      rewritten: forced !== rawDraft,
      method: "forced_deterministic",
      beforeMetrics,
      afterMetrics: withProfileStructuralPass(
        computeAdhdResponseMetrics(forced, { wordCap }),
        profile,
        forced,
      ),
      oversightDurationMs: Date.now() - oversightStartedAt,
      oversightUsage: usageAcc,
    };
  }
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
