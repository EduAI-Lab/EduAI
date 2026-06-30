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
};

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
  const topSummary = leadingStripped.startsWith("**Top summary**");

  const lines = trimmed.split(/\r?\n/);
  const tail = lines.slice(-3).join("\n");
  const nextLine = /\*\*Next\?\*\*/.test(tail);

  const underCap = wordCount <= wordCap;

  return { wordCount, topSummary, nextLine, underCap, oneTopic: null };
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
  return hasRedirectCue || hasForwardOffer;
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
