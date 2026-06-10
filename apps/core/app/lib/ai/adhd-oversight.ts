import { generateText, type LanguageModel } from "ai";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  computeAdhdResponseMetrics,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withStructuralPass,
  type AdhdStructuralCompliance,
} from "~/lib/ai/adhd-metrics";

export const ADHD_OVERSIGHT_REWRITE_SYSTEM = `You are a formatting editor for ADHD Assist Mode chat responses.
Rewrite the draft to satisfy ALL structural rules without changing facts, numbers, or meaning.

REQUIRED MARKDOWN STRUCTURE:
1) First line MUST be exactly: **Top summary**
2) Then 1-3 bullet points that answer the learner's question.
3) If steps are needed, add a "### Step ladder" section with at most 5 numbered steps.
4) End with a standalone line: **Next?** <one short continuation offer>

LENGTH: Hard cap 250 words for tutoring answers; 120 for brief clarifications.
No emojis. No filler ("Great question!", "Certainly!").
Return ONLY the rewritten response.`;

export type OversightMethod = "none" | "deterministic" | "llm" | "llm_failed";

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

function structuralScore(metrics: AdhdStructuralCompliance): number {
  return (
    (metrics.topSummary ? 1 : 0) +
    (metrics.nextLine ? 1 : 0) +
    (metrics.underCap ? 1 : 0)
  );
}

function lastNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/** Prefer an existing trailing question (e.g. redirect prompts) over generic filler. */
export function extractNextPromptCandidate(text: string): string | null {
  const last = lastNonEmptyLine(text);
  if (!last) return null;
  if (/^Next\?\s/i.test(last)) {
    const prompt = last.replace(/^Next\?\s*/i, "").trim();
    return prompt.length > 0 ? prompt : null;
  }
  if (last.endsWith("?")) return last;
  return null;
}

/**
 * Promote an inline or trailing continuation prompt to the required **Next?** anchor.
 * Returns null when no candidate exists (caller should try LLM rewrite).
 */
export function applyNextLineAnchor(text: string): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const inline =
    trimmed.match(/\nNext\?\s+(.+)$/i) ?? trimmed.match(/^Next\?\s+(.+)$/im);
  if (inline?.[1]) {
    const body = trimmed.replace(/\n?Next\?\s+.+$/i, "").trimEnd();
    return `${body}\n\n**Next?** ${inline[1].trim()}`;
  }

  const candidate = extractNextPromptCandidate(trimmed);
  if (!candidate) return null;

  let body = trimmed;
  if (body.endsWith(candidate)) {
    body = body.slice(0, body.length - candidate.length).trimEnd();
  }
  return `${body}\n\n**Next?** ${candidate}`;
}

/** Fast path: fix missing literal anchors without an LLM call. */
export function tryDeterministicStructuralFix(
  draft: string,
  options?: { wordCap?: number },
): string | null {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return null;

  const before = computeAdhdResponseMetrics(trimmed, { wordCap });
  if (isStructuralCompliancePass(before)) {
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

  const after = computeAdhdResponseMetrics(fixed, { wordCap });
  return isStructuralCompliancePass(after) ? fixed : null;
}

export async function auditAndMaybeRewrite(args: {
  draft: string;
  model: LanguageModel;
  wordCap?: number;
}): Promise<AuditAndMaybeRewriteResult> {
  const wordCap = args.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const trimmed = (args.draft ?? "").trim();
  const beforeMetrics = withStructuralPass(
    computeAdhdResponseMetrics(trimmed, { wordCap }),
  );

  if (!trimmed) {
    return emptyOversightAuditResult();
  }

  if (!isOversightEligibleDraft(trimmed)) {
    return {
      text: trimmed,
      rewritten: false,
      method: "none",
      beforeMetrics,
      afterMetrics: beforeMetrics,
      oversightDurationMs: 0,
      oversightUsage: null,
    };
  }

  if (beforeMetrics.structuralPass) {
    return {
      text: trimmed,
      rewritten: false,
      method: "none",
      beforeMetrics,
      afterMetrics: beforeMetrics,
      oversightDurationMs: 0,
      oversightUsage: null,
    };
  }

  const deterministic = tryDeterministicStructuralFix(trimmed, { wordCap });
  if (deterministic) {
    const afterMetrics = withStructuralPass(
      computeAdhdResponseMetrics(deterministic, { wordCap }),
    );
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

  const oversightStartedAt = Date.now();
  try {
    const { text: rewritten, usage } = await generateText({
      model: args.model,
      temperature: 0.2,
      maxTokens: 1024,
      system: ADHD_OVERSIGHT_REWRITE_SYSTEM,
      prompt: `DRAFT TO REWRITE:\n\n${trimmed}`,
    });

    const llmText = (rewritten ?? "").trim();
    const afterMetrics = withStructuralPass(
      computeAdhdResponseMetrics(llmText, { wordCap }),
    );

    const useLlm =
      llmText.length > 0 &&
      afterMetrics.underCap &&
      (afterMetrics.structuralPass ||
        structuralScore(afterMetrics) > structuralScore(beforeMetrics));

    const finalText = useLlm ? llmText : trimmed;
    const finalMetrics = useLlm ? afterMetrics : beforeMetrics;

    return {
      text: finalText,
      rewritten: useLlm,
      method: useLlm ? "llm" : "none",
      beforeMetrics,
      afterMetrics: finalMetrics,
      oversightDurationMs: Date.now() - oversightStartedAt,
      oversightUsage: {
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
      },
    };
  } catch (error) {
    console.error("[adhd-oversight] LLM rewrite failed", error);
    return {
      text: trimmed,
      rewritten: false,
      method: "llm_failed",
      beforeMetrics,
      afterMetrics: beforeMetrics,
      oversightDurationMs: Date.now() - oversightStartedAt,
      oversightUsage: null,
    };
  }
}

/** @deprecated Use resolveAdhdResponseWordCap from adhd-metrics.ts */
export function resolveAdhdWordCap(userText?: string): number {
  return resolveAdhdResponseWordCap(userText);
}
