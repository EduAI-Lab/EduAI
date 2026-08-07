/**
 * Derived ADHD Assist response compliance metrics (no message text stored in telemetry).
 * Shared by chat onFinish logging, eval harness, and report scripts.
 */

import {
  getProfileRequirements,
  type AdhdTurnProfile,
} from "~/lib/ai/adhd-turn-profile";

export const ADHD_TUTORING_WORD_CAP = 250;
export const ADHD_CLARIFICATION_WORD_CAP = 120;

/**
 * User turns at or below this length use the clarification response cap.
 * Policy §3 defines two assistant caps (120 clarification / 250 tutoring) but
 * not how to classify the learner turn; we treat ≤20-word messages as brief
 * confirmations or one-line follow-ups (e.g. "yes", "ok", "what about step 2?").
 */
export const ADHD_CLARIFICATION_USER_WORD_THRESHOLD = 20;

export type AdhdResponseMetrics = {
  wordCount: number;
  topSummary: boolean;
  nextLine: boolean;
  underCap: boolean;
  /** Placeholder for future single-topic heuristics; null = not evaluated. */
  oneTopic: boolean | null;
  /** False when time-pressure / urgency language is present (policy STYLE rule). */
  noUrgency: boolean;
  /** True when the reply ends with a Sources footer (citation presence). */
  hasSources: boolean;
  /** True when a real "### Step ladder" section (heading + numbered steps) is present. */
  stepLadder: boolean;
};

/**
 * Time-pressure / urgency terms banned by the ADHD Assist STYLE rule. A baseline
 * study failure was the participant "feeling rushed"; ADHD participants flagged
 * words like "quickly" / "fast" leaking through. Per prompt-policy OQ2 the
 * detector is intentionally blunt — the oversight rewrite decides phrasing, and a
 * rewrite that still trips is rejected rather than corrupting output.
 */
export const ADHD_URGENCY_TERMS = [
  "quickly",
  "quick",
  "fast",
  "faster",
  "hurry",
  "hurried",
  "hurrying",
  "rush",
  "rushed",
  "rushing",
  "asap",
  "immediately",
  "right away",
  "as soon as possible",
  "no time",
  "running out of time",
] as const;

/** Return the lower-cased urgency terms found in the text (empty when clean). */
export function detectUrgencyTerms(text: string): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  // Build a fresh regex per call so the global flag's lastIndex never leaks.
  const re = new RegExp(`\\b(?:${ADHD_URGENCY_TERMS.join("|")})\\b`, "gi");
  const matches = trimmed.match(re);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

const SOURCES_MARKER_RE = /^\s*(?:\*\*sources\*?\*?|#{1,6}\s*sources\b|sources:)/i;
const NEXT_LINE_PARAGRAPH_RE = /^\s*\*\*next\?\*\*/i;

const STEP_LADDER_HEADING_RE = /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}step ladder\*{0,2}\s*(?:\n|$)/i;
const NUMBERED_LIST_ITEM_RE = /^\s*\d+\.\s+\S/m;

/**
 * Detect a real "Step ladder" section: the heading plus at least one
 * numbered step — not just the bare words "step ladder" mentioned in prose,
 * and not a bare Top summary / Next? shell with no expanded steps (#1245).
 */
export function hasStepLadderSection(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  return STEP_LADDER_HEADING_RE.test(trimmed) && NUMBERED_LIST_ITEM_RE.test(trimmed);
}

/**
 * Detect a Sources footer (e.g. "**Sources**", "### Sources", "Sources:").
 * Anchored to the tail of the reply, not just any matching line: a mid-answer
 * "Sources:" aside or a "## Sources of X" heading with real content afterward
 * is not a footer. Scans paragraphs from the end, allowing the template's
 * trailing "**Next?**" paragraph to sit after the footer.
 */
export function hasSourcesFooter(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  const paragraphs = trimmed.split(/\n\s*\n/);
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const paragraph = paragraphs[i];
    if (SOURCES_MARKER_RE.test(paragraph)) return true;
    if (!NEXT_LINE_PARAGRAPH_RE.test(paragraph)) return false;
  }
  return false;
}

export type AdhdStructuralCompliance = AdhdResponseMetrics & {
  structuralPass: boolean;
};

export function computeAdhdResponseMetrics(
  assistantText: string,
  options?: { wordCap?: number },
): AdhdResponseMetrics {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const trimmed = (assistantText ?? "").trim();
  const words =
    trimmed.length === 0 ? [] : trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const leadingStripped = trimmed.replace(/^\s{0,2}/, "");
  // Accept common Top summary variants (* Top summary, Top summary:) — oversight
  // still normalizes to **Top summary** before emit.
  const topSummary =
    leadingStripped.startsWith("**Top summary**") ||
    /^(?:\*{1,2}\s*)?Top\s+summary(?:\*{1,2})?\b/i.test(leadingStripped);

  const lines = trimmed.split(/\r?\n/);
  const tail = lines.slice(-3).join("\n");
  // Next? must be the bold policy anchor; unbolded "Next?" is not enough.
  const nextLine = /\*\*Next\?\*\*/.test(tail);

  const underCap = wordCount <= wordCap;

  const noUrgency = detectUrgencyTerms(trimmed).length === 0;
  const hasSources = hasSourcesFooter(trimmed);
  const stepLadder = hasStepLadderSection(trimmed);

  return {
    wordCount,
    topSummary,
    nextLine,
    underCap,
    oneTopic: null,
    noUrgency,
    hasSources,
    stepLadder,
  };
}

export function isStructuralCompliancePass(metrics: AdhdResponseMetrics): boolean {
  return metrics.topSummary && metrics.nextLine && metrics.underCap;
}

export function withStructuralPass(
  metrics: AdhdResponseMetrics,
): AdhdStructuralCompliance {
  return {
    ...metrics,
    structuralPass: isStructuralCompliancePass(metrics),
  };
}

export function resolveAdhdResponseWordCap(userText?: string): number {
  const trimmed = (userText ?? "").trim();
  if (!trimmed) return ADHD_TUTORING_WORD_CAP;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount <= ADHD_CLARIFICATION_USER_WORD_THRESHOLD
    ? ADHD_CLARIFICATION_WORD_CAP
    : ADHD_TUTORING_WORD_CAP;
}

/**
 * A proper redirect is a short acknowledge-and-offer, e.g. "That's a
 * separate question from dishwashing. My goal is to keep explanations
 * clear and focused on one topic at a time. Want to come back to the
 * dishwashing steps first, or switch now?" (3 sentences). Cap sentence
 * count so a reply that still has the required cue/offer phrasing but
 * also slips in an explanation of the off-topic ask (#1313 scenario
 * topic bleed) gets rejected instead of accepted on phrase-match alone.
 */
export const MAX_REDIRECT_SENTENCES = 3;

export function countSentences(text: string): number {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return matches ? matches.filter((s) => s.trim().length > 0).length : 0;
}

/**
 * Phrasing that states/defines a fact rather than just naming a topic, e.g.
 * "marginal tax brackets mean ..." or "... taxed at 10%". A reply can name
 * the second topic once (in the ack or the offer question) and still stay
 * at or under MAX_REDIRECT_SENTENCES — the sentence cap alone does not
 * catch a short reply that answers the off-topic ask in a single sentence
 * (#1421 review: "a three-sentence reply can still answer the second
 * topic and pass this check"). Intentionally blunt, matching
 * ADHD_URGENCY_TERMS above — stating a fact in English almost always uses
 * a defining/causal connector or a percentage, so this catches the
 * concrete bleed case without needing to know what the second topic is.
 */
const REDIRECT_BLEED_MARKERS_RE =
  /\b(?:means?|mean that|refers? to|works? by|because|due to|results? in|leads? to|causes?|defined? as|such as|for example|for instance|e\.g\.|i\.e\.|in other words|which means)\b|\d+%/i;

/** Return true when the text states/defines a fact rather than just naming a topic. */
export function hasRedirectBleedContent(text: string): boolean {
  return REDIRECT_BLEED_MARKERS_RE.test((text ?? "").trim());
}

/** §5 drift redirect: one-topic boundary without Top summary scaffolding. */
export function isRedirectTemplatePass(
  metrics: AdhdResponseMetrics,
  assistantText: string,
): boolean {
  if (!metrics.underCap || metrics.topSummary) return false;
  const trimmed = (assistantText ?? "").trim();
  const hasRedirectCue = /separate question|one topic|come back|switch now|separate topic/i.test(
    trimmed,
  );
  const hasForwardOffer =
    trimmed.endsWith("?") &&
    /want to|would you like|or switch|come back|ready to/i.test(trimmed);
  if (!(hasRedirectCue || hasForwardOffer)) return false;
  if (countSentences(trimmed) > MAX_REDIRECT_SENTENCES) return false;
  return !hasRedirectBleedContent(trimmed);
}

/** Profile-conditional structural pass (Approach A). */
export function isProfileStructuralPass(
  metrics: AdhdResponseMetrics,
  profile: AdhdTurnProfile,
  assistantText = "",
): boolean {
  const req = getProfileRequirements(profile);
  if (!metrics.underCap) return false;

  if (req.expectRedirectTemplate) {
    return isRedirectTemplatePass(metrics, assistantText);
  }

  if (req.expectTopSummary && !metrics.topSummary) return false;
  if (req.expectNextLine && !metrics.nextLine) return false;

  return true;
}

export function withProfileStructuralPass(
  metrics: AdhdResponseMetrics,
  profile: AdhdTurnProfile,
  assistantText = "",
): AdhdStructuralCompliance & { profileStructuralPass: boolean } {
  const profileStructuralPass = isProfileStructuralPass(metrics, profile, assistantText);
  return {
    ...metrics,
    structuralPass: profileStructuralPass,
    profileStructuralPass,
  };
}
