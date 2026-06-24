import { randomUUID } from "crypto";
import { generateText, type LanguageModel } from "ai";
import {
  getProfileRequirements,
  type AdhdTurnProfile,
} from "~/lib/ai/adhd-turn-profile";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  computeAdhdResponseMetrics,
  isProfileStructuralPass,
  isRedirectTemplatePass,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withProfileStructuralPass,
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

LENGTH: Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.
Remove any urgency or time-pressure wording (e.g. "quickly", "fast", "hurry", "right away"); never rush the learner.
No emojis. No filler ("Great question!", "Certainly!").
Return ONLY the rewritten response.`;

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

export function buildOversightRewriteSystem(profile: AdhdTurnProfile, wordCap: number): string {
  if (profile === "redirect") {
    return ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM;
  }
  if (profile === "brief_clarification") {
    return ADHD_OVERSIGHT_REWRITE_SYSTEM.replace(
      `Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.`,
      `Hard cap ${wordCap} words.`,
    );
  }
  return ADHD_OVERSIGHT_REWRITE_SYSTEM.replace(
    `Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.`,
    `Hard cap ${wordCap} words.`,
  );
}

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
 * Returns null when no candidate exists (caller should try LLM rewrite).
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

function profileStructuralScore(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
): number {
  let score = metrics.underCap ? 1 : 0;
  const req = getProfileRequirements(profile);
  if (req.expectTopSummary) score += metrics.topSummary ? 1 : 0;
  if (req.expectNextLine) score += metrics.nextLine ? 1 : 0;
  if (req.expectRedirectTemplate && isRedirectTemplatePass(metrics, text)) score += 2;
  return score;
}

function passesProfileStructure(
  metrics: AdhdStructuralCompliance,
  profile: AdhdTurnProfile,
  text: string,
): boolean {
  return isProfileStructuralPass(metrics, profile, text);
}

/** Fast path: fix missing literal anchors without an LLM call. */
export function tryDeterministicStructuralFix(
  draft: string,
  options?: { wordCap?: number; profile?: AdhdTurnProfile },
): string | null {
  const wordCap = options?.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = options?.profile;
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return null;

  if (profile) {
    const before = withProfileStructuralPass(
      computeAdhdResponseMetrics(trimmed, { wordCap }),
      profile,
      trimmed,
    );
    if (before.profileStructuralPass) {
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
  profile?: AdhdTurnProfile;
}): Promise<AuditAndMaybeRewriteResult> {
  const wordCap = args.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = args.profile ?? "full_tutoring";
  const trimmed = (args.draft ?? "").trim();
  const profileReq = getProfileRequirements(profile);

  const beforeMetrics = withProfileStructuralPass(
    computeAdhdResponseMetrics(trimmed, { wordCap }),
    profile,
    trimmed,
  );

  if (!trimmed) {
    return emptyOversightAuditResult();
  }

  if (!profileReq.runDean) {
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

  // Content pass = profile structure AND no urgency language. Citations are
  // measured (metrics.hasSources) but not enforced here: the Dean has no access
  // to the source material and must never confabulate a Sources footer.
  if (passesProfileStructure(beforeMetrics, profile, trimmed) && beforeMetrics.noUrgency) {
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

  const deterministic = tryDeterministicStructuralFix(trimmed, { wordCap, profile });
  if (deterministic) {
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(deterministic, { wordCap }),
      profile,
      deterministic,
    );
    // The deterministic fix only repairs structure; it cannot remove urgency
    // wording, so accept it only when the draft is already urgency-clean.
    // Otherwise fall through to the LLM rewrite.
    if (afterMetrics.noUrgency) {
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
  try {
    const { text: rewritten, usage } = await generateText({
      model: args.model,
      temperature: 0.2,
      maxTokens: 1024,
      system: buildOversightRewriteSystem(profile, wordCap),
      prompt: `DRAFT TO REWRITE:\n\n${trimmed}`,
    });

    const llmText = (rewritten ?? "").trim();
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(llmText, { wordCap }),
      profile,
      llmText,
    );

    // When urgency triggered the rewrite, only accept a result that is clean;
    // a rewrite that still trips urgency is rejected and the draft is kept.
    const urgencyWasProblem = !beforeMetrics.noUrgency;
    const useLlm =
      llmText.length > 0 &&
      afterMetrics.underCap &&
      (!urgencyWasProblem || afterMetrics.noUrgency) &&
      (afterMetrics.profileStructuralPass ||
        profileStructuralScore(afterMetrics, profile, llmText) >
          profileStructuralScore(beforeMetrics, profile, trimmed));

    const finalText = useLlm ? llmText : trimmed;
    const finalMetrics = useLlm
      ? afterMetrics
      : beforeMetrics;

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
    const assistantMessages = responseMessages.filter((message) => message.role === "assistant");
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
