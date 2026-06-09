import { generateText, type LanguageModel } from "ai";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  computeAdhdResponseMetrics,
  isStructuralCompliancePass,
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

export type AuditAndMaybeRewriteResult = {
  text: string;
  rewritten: boolean;
  method: "none" | "deterministic" | "llm";
  beforeMetrics: AdhdStructuralCompliance;
  afterMetrics: AdhdStructuralCompliance;
};

export function isAdhdOversightEnabled(): boolean {
  const raw = process.env.ADHD_ASSIST_OVERSIGHT?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

function structuralScore(metrics: AdhdStructuralCompliance): number {
  return (
    (metrics.topSummary ? 1 : 0) +
    (metrics.nextLine ? 1 : 0) +
    (metrics.underCap ? 1 : 0)
  );
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
    const lines = fixed.split(/\r?\n/);
    const lastLine = lines[lines.length - 1] ?? "";
    if (/^Next\?\s/i.test(lastLine)) {
      lines[lines.length - 1] = lastLine.replace(/^Next\?\s*/i, "**Next?** ");
      fixed = lines.join("\n");
    } else {
      const inline = fixed.match(/\nNext\?\s+(.+)$/i) ?? fixed.match(/^Next\?\s+(.+)$/im);
      if (inline) {
        fixed = fixed.replace(/\n?Next\?\s+.+$/i, "").trimEnd();
        fixed += `\n\n**Next?** ${inline[1].trim()}`;
      } else {
        fixed += "\n\n**Next?** Want me to expand on any part of this?";
      }
    }
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

  if (!trimmed || beforeMetrics.structuralPass) {
    return {
      text: trimmed,
      rewritten: false,
      method: "none",
      beforeMetrics,
      afterMetrics: beforeMetrics,
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
    };
  }

  const { text: rewritten } = await generateText({
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
    afterMetrics.structuralPass ||
    structuralScore(afterMetrics) > structuralScore(beforeMetrics);

  const finalText = useLlm ? llmText : trimmed;
  const finalMetrics = useLlm ? afterMetrics : beforeMetrics;

  return {
    text: finalText,
    rewritten: useLlm,
    method: useLlm ? "llm" : "none",
    beforeMetrics,
    afterMetrics: finalMetrics,
  };
}

export function resolveAdhdWordCap(userText?: string): number {
  const trimmed = (userText ?? "").trim();
  if (!trimmed) return ADHD_TUTORING_WORD_CAP;
  const isClarification =
    /^(yes|no|ok|okay|thanks|thank you|got it|sure)\b/i.test(trimmed) ||
    trimmed.length < 80;
  return isClarification ? ADHD_CLARIFICATION_WORD_CAP : ADHD_TUTORING_WORD_CAP;
}
