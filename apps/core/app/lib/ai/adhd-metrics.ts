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

/**
 * The Session Tasks checklist (v2.0) is instructed to render before
 * **Top summary** when present. Strip a leading checklist paragraph before
 * checking the **Top summary** anchor so a compliant Session Tasks-prefixed
 * reply isn't scored as missing Top summary.
 */
function stripLeadingSessionTasksBlock(text: string): string {
  const trimmed = text.trimStart();
  if (!/^\*\*Session Tasks:\*\*/i.test(trimmed)) return text;
  const blankLineIdx = trimmed.search(/\n\s*\n/);
  if (blankLineIdx === -1) return text;
  return trimmed.slice(blankLineIdx).trimStart();
}

export function computeAdhdResponseMetrics(
  assistantText: string,
  options?: { wordCap?: number },
): AdhdResponseMetrics {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const trimmed = (assistantText ?? "").trim();
  const words =
    trimmed.length === 0 ? [] : trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const topSummarySource = stripLeadingSessionTasksBlock(trimmed);
  const leadingStripped = topSummarySource.replace(/^\s{0,2}/, "");
  const topSummary = leadingStripped.startsWith("**Top summary**");

  const lines = trimmed.split(/\r?\n/);
  const tail = lines.slice(-3).join("\n");
  const nextLine = /\*\*Next\?\*\*/.test(tail);

  const underCap = wordCount <= wordCap;

  const noUrgency = detectUrgencyTerms(trimmed).length === 0;
  const hasSources = hasSourcesFooter(trimmed);

  return { wordCount, topSummary, nextLine, underCap, oneTopic: null, noUrgency, hasSources };
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
 * Topic-switch flag: the reply must name the A/B/C choice explicitly, in
 * order (finish current task / park new topic / switch now), rather than
 * silently following the drift.
 */
export function hasTopicSwitchAbcOptions(assistantText: string): boolean {
  const trimmed = (assistantText ?? "").trim();
  return /\btopic switch\b[\s\S]*\*\*A\)\*\*[\s\S]*\*\*B\)\*\*[\s\S]*\*\*C\)\*\*/i.test(
    trimmed,
  );
}

/** True when a draft looks like an attempt at the v2.0 A/B/C template. */
function looksLikeAbcAttempt(assistantText: string): boolean {
  return /\btopic switch\b|\*\*A\)\*\*|\*\*B\)\*\*|\*\*C\)\*\*/i.test(assistantText);
}

/**
 * §5 drift redirect: one-topic boundary without Top summary scaffolding.
 * Accepts the v2.0 A/B/C topic-switch template, or the legacy single-question
 * redirect offer (pre-v2.0 policy / baseline study transcripts) so older
 * captured fixtures keep scoring as compliant. A draft that looks like an
 * attempt at the A/B/C template but botches it (missing a marker, wrong
 * order) must NOT fall through to the legacy check - the v2.0 template's own
 * wording ("come back", "switch now") would otherwise satisfy the legacy
 * cues too, silently accepting a malformed new-style draft.
 */
export function isRedirectTemplatePass(
  metrics: AdhdResponseMetrics,
  assistantText: string,
): boolean {
  if (!metrics.underCap || metrics.topSummary) return false;
  const trimmed = (assistantText ?? "").trim();

  if (hasTopicSwitchAbcOptions(trimmed)) return true;
  if (looksLikeAbcAttempt(trimmed)) return false;

  const hasRedirectCue = /separate question|one topic|come back|switch now|separate topic/i.test(
    trimmed,
  );
  const hasForwardOffer =
    trimmed.endsWith("?") &&
    /want to|would you like|or switch|come back|ready to/i.test(trimmed);
  return hasRedirectCue || hasForwardOffer;
}

const SESSION_TASKS_CHECKLIST_RE = /\*\*Session Tasks:\*\*/i;
const SESSION_TASKS_ASK_RE = /what are we working on today/i;
const SESSION_TASKS_DONE_RE =
  /session (goal|list) is (done|empty|complete)|list is empty|nothing(?:'s| is)? active|what.*work on next/i;

export function hasSessionTasksChecklist(text: string): boolean {
  return SESSION_TASKS_CHECKLIST_RE.test(text ?? "");
}

export function asksSessionTasksGoal(text: string): boolean {
  return SESSION_TASKS_ASK_RE.test(text ?? "");
}

export function acknowledgesSessionTasksDone(text: string): boolean {
  return SESSION_TASKS_DONE_RE.test(text ?? "");
}

/**
 * Session Tasks bootstrap/continuity check (v2.0). There is no persisted
 * session-task state, so this enforces only the two invariants derivable
 * from conversation text alone:
 *  - First turn: the reply must either start a checklist or ask the
 *    "What are we working on today?" clarifying question.
 *  - Continuity: once a prior assistant turn showed a checklist, this turn
 *    must keep showing one, or explicitly say the list is done/empty.
 * Profiles that never carry the Session Tasks instruction (greeting,
 * confirmation) are always compliant - not applicable to them.
 */
export function isSessionTasksCompliant(
  assistantText: string,
  options: {
    profileExpectsSessionTasks: boolean;
    isFirstTurn: boolean;
    priorHadSessionTasks: boolean;
  },
): boolean {
  if (!options.profileExpectsSessionTasks) return true;
  const trimmed = assistantText ?? "";
  if (hasSessionTasksChecklist(trimmed)) return true;
  if (options.isFirstTurn) return asksSessionTasksGoal(trimmed);
  if (options.priorHadSessionTasks) return acknowledgesSessionTasksDone(trimmed);
  return true;
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
