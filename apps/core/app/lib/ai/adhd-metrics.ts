/**
 * Derived ADHD Assist response compliance metrics (no message text stored in telemetry).
 * Shared by chat onFinish logging, eval harness, and report scripts.
 */

export const ADHD_TUTORING_WORD_CAP = 250;
export const ADHD_CLARIFICATION_WORD_CAP = 120;

/** User turns at or below this length use the clarification response cap (see policy §3). */
export const ADHD_CLARIFICATION_USER_WORD_THRESHOLD = Math.floor(
  ADHD_CLARIFICATION_WORD_CAP / 6,
);

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
