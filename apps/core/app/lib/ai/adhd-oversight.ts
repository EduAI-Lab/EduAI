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
  hasSessionTasksChecklist,
  isProfileStructuralPass,
  isRedirectTemplatePass,
  isSessionTasksCompliant,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withProfileStructuralPass,
  withStructuralPass,
  type AdhdStructuralCompliance,
} from "~/lib/ai/adhd-metrics";
import {
  ensureDiagramBeforeNext,
  hasEduaiDiagramFence,
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
6) If the draft includes a "**Session Tasks:**" checklist, keep it verbatim near the top, before **Top summary**. Do not drop or shorten it.

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

/**
 * Appended when the draft fails the Session Tasks bootstrap/continuity check
 * (see isSessionTasksCompliant in adhd-metrics.ts) — either this is the first
 * turn of a goal-setting message with no checklist or clarifying ask, or a
 * prior turn showed a checklist that this draft silently dropped.
 */
const ADHD_OVERSIGHT_SESSION_TASKS_REQUIRED_ADDENDUM = `

SESSION TASKS REQUIRED (missing from the draft):
- If this is the first turn and the learner's message states or implies a
  working goal: add a "**Session Tasks:**" checklist (a few concrete
  verb+object subtasks derived from the learner's message), OR, if the goal
  isn't concrete enough yet, ask "What are we working on today?" before
  answering.
- If a prior turn already showed a "**Session Tasks:**" checklist: reconstruct
  and continue that same checklist near the top of this reply (same items/
  order where still relevant), unless the goal is now done - then say so
  briefly instead.
Do not invent unrelated tasks.`;

const ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM = `You are a formatting editor for ADHD Assist Mode topic-switch flags.
The learner asked about a second topic while another is in progress.

RULES:
- Do NOT add a "Top summary" block. Do NOT answer the new topic.
- Rewrite so the response uses this exact A/B/C structure, keeping the
  learner's real current task name from the draft (never invent one; keep
  it a short label, a few words - not a full sentence):
  Looks like a topic switch. We were working on **<current task>**. Want to:
  **A)** Finish <current task> first, then come back to this
  **B)** Add this to the todo list and stay on <current task>
  **C)** Switch now (I'll save progress on <current task>)
- If the draft includes a "**Session Tasks:**" checklist, keep it verbatim
  before the A/B/C block. Do not drop or shorten it.
- Hard cap ${ADHD_CLARIFICATION_WORD_CAP} words.
- Remove any urgency or time-pressure wording ("quickly", "fast", "hurry"); never rush the learner.
- No emojis. No filler.
Return ONLY the rewritten response.`;

export function buildOversightRewriteSystem(
  profile: AdhdTurnProfile,
  wordCap: number,
  options?: { requireDiagram?: boolean; requireSessionTasks?: boolean },
): string {
  if (profile === "redirect") {
    let redirectSystem = ADHD_OVERSIGHT_REDIRECT_REWRITE_SYSTEM;
    if (options?.requireSessionTasks) {
      redirectSystem += ADHD_OVERSIGHT_SESSION_TASKS_REQUIRED_ADDENDUM;
    }
    return redirectSystem;
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
  if (options?.requireSessionTasks) {
    system += ADHD_OVERSIGHT_SESSION_TASKS_REQUIRED_ADDENDUM;
  }
  return system;
}

export type OversightMethod =
  | "none"
  | "deterministic"
  | "llm"
  | "llm_rejected"
  | "llm_failed";

/**
 * Output budget for the LLM rewrite. A compliant rewrite is at most `wordCap`
 * words, but a fixed 1024-token cap truncated rewrites of long drafts — and a
 * truncated rewrite fails validation, so we silently shipped the original
 * non-compliant draft (#714). Budget tokens from the word cap with headroom for
 * markdown anchors (**Top summary**, bullets, ### Step ladder, **Next?**) and
 * tokenizer variance, with a floor so the smaller clarification/redirect caps
 * still get adequate room. maxTokens only bounds output, so over-budgeting is
 * safe: the model stops once the rewrite is done.
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
      computeAdhdResponseMetrics(trimmed, { wordCap, allowLeadingSessionTasks: true }),
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
          computeAdhdResponseMetrics(withNext, { wordCap, allowLeadingSessionTasks: true }),
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

  const before = computeAdhdResponseMetrics(trimmed, { wordCap, allowLeadingSessionTasks: true });
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

  const after = computeAdhdResponseMetrics(fixed, { wordCap, allowLeadingSessionTasks: true });
  return isStructuralCompliancePass(after) ? fixed : null;
}

export async function auditAndMaybeRewrite(args: {
  draft: string;
  model: LanguageModel;
  wordCap?: number;
  profile?: AdhdTurnProfile;
  userText?: string;
  priorAssistantText?: string;
}): Promise<AuditAndMaybeRewriteResult> {
  const wordCap = args.wordCap ?? ADHD_TUTORING_WORD_CAP;
  const profile = args.profile ?? "full_tutoring";
  const trimmed = (args.draft ?? "").trim();
  const profileReq = getProfileRequirements(profile);
  // Redirect turns must never answer the new topic (policy §5), so a diagram
  // request embedded in the off-topic message must not force one into the
  // A/B/C flag - that would hand the Dean contradictory instructions (system
  // prompt says withhold the new topic, user prompt says draw it).
  const requireDiagram =
    profile !== "redirect" &&
    userRequestedDiagram(args.userText) &&
    !hasEduaiDiagramFence(trimmed);
  const diagramOpts = { userText: args.userText };

  // Only enforce the first-turn bootstrap when the caller explicitly signals
  // conversation state (chat.ts always passes priorAssistantText, even as an
  // empty string on a genuine first message). Callers that omit the field
  // entirely (e.g. most existing unit tests) get no Session Tasks
  // bootstrap/continuity enforcement rather than being treated as "first turn".
  const isFirstTurn =
    args.priorAssistantText !== undefined && !args.priorAssistantText.trim();
  const priorHadSessionTasks = hasSessionTasksChecklist(args.priorAssistantText ?? "");
  const sessionTasksContext = {
    profileExpectsSessionTasks: profileReq.expectSessionTasksContext,
    isFirstTurn,
    priorHadSessionTasks,
  };
  const sessionTasksOk = isSessionTasksCompliant(trimmed, sessionTasksContext);

  const beforeMetrics = withProfileStructuralPass(
    computeAdhdResponseMetrics(trimmed, { wordCap, allowLeadingSessionTasks: true }),
    profile,
    trimmed,
  );

  if (!trimmed) {
    return emptyOversightAuditResult();
  }

  if (!profileReq.runDean) {
    // Even when Dean is off, never ship a diagram-request reply with no fence.
    if (requireDiagram) {
      const withDiagram = ensureDiagramBeforeNext(trimmed, diagramOpts);
      return {
        text: withDiagram,
        rewritten: withDiagram !== trimmed,
        method: withDiagram !== trimmed ? "deterministic" : "none",
        beforeMetrics,
        afterMetrics: withProfileStructuralPass(
          computeAdhdResponseMetrics(withDiagram, { wordCap, allowLeadingSessionTasks: true }),
          profile,
          withDiagram,
        ),
        oversightDurationMs: 0,
        oversightUsage: null,
      };
    }
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
  // Diagram requests with no fence, and drafts missing a required Session
  // Tasks checklist/ask, never early-exit — they need a rewrite/inject.
  if (
    !requireDiagram &&
    sessionTasksOk &&
    passesProfileStructure(beforeMetrics, profile, trimmed) &&
    beforeMetrics.noUrgency
  ) {
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
  if (deterministic && !requireDiagram && sessionTasksOk) {
    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(deterministic, { wordCap, allowLeadingSessionTasks: true }),
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

  const requireSessionTasksFix = !sessionTasksOk;
  const sessionTasksNote = requireSessionTasksFix
    ? isFirstTurn
      ? '\n\nThe learner\'s message states or implies a working goal - your reply is missing the required opening: either a "**Session Tasks:**" checklist for it, or the "What are we working on today?" question.'
      : '\n\nThe previous turn showed a "**Session Tasks:**" checklist - continue it near the top of this reply (or say the goal is done), don\'t drop it.'
    : "";

  const oversightStartedAt = Date.now();
  try {
    const { text: rewritten, usage } = await generateText({
      model: args.model,
      temperature: 0.2,
      maxTokens: resolveOversightRewriteMaxTokens(wordCap),
      system: buildOversightRewriteSystem(profile, wordCap, {
        requireDiagram,
        requireSessionTasks: requireSessionTasksFix,
      }),
      prompt:
        (requireDiagram
          ? `The learner asked for a diagram. Rewrite so the reply includes one eduai-diagram fence with topic-specific stage labels (type: process-flow, gradient-descent, hierarchy, or compare — default process-flow). Stages must match Top summary / Step ladder names.\n\nLEARNER MESSAGE:\n${args.userText ?? "(unknown)"}\n\nDRAFT TO REWRITE:\n\n${trimmed}`
          : `DRAFT TO REWRITE:\n\n${trimmed}`) + sessionTasksNote,
    });

    let llmText = (rewritten ?? "").trim();
    if (requireDiagram && llmText && !hasEduaiDiagramFence(llmText)) {
      llmText = ensureDiagramBeforeNext(llmText, diagramOpts);
    }

    const afterMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(llmText, { wordCap, allowLeadingSessionTasks: true }),
      profile,
      llmText,
    );

    // When urgency triggered the rewrite, only accept a result that is clean;
    // a rewrite that still trips urgency is rejected and the draft is kept.
    // requireDiagram/requireSessionTasksFix must NOT bypass profileStructuralPass —
    // an inject still needs valid Top summary / Next? (or a structural score gain)
    // before adopt.
    const urgencyWasProblem = !beforeMetrics.noUrgency;
    const diagramOk = !requireDiagram || hasEduaiDiagramFence(llmText);
    const sessionTasksOkAfter =
      !requireSessionTasksFix || isSessionTasksCompliant(llmText, sessionTasksContext);
    const structuralOk =
      afterMetrics.profileStructuralPass ||
      profileStructuralScore(afterMetrics, profile, llmText) >
        profileStructuralScore(beforeMetrics, profile, trimmed);
    const useLlm =
      llmText.length > 0 &&
      afterMetrics.underCap &&
      diagramOk &&
      sessionTasksOkAfter &&
      (!urgencyWasProblem || afterMetrics.noUrgency) &&
      structuralOk;

    let finalText = useLlm ? llmText : trimmed;
    if (requireDiagram && !hasEduaiDiagramFence(finalText)) {
      finalText = ensureDiagramBeforeNext(finalText, diagramOpts);
    }
    const finalMetrics = withProfileStructuralPass(
      computeAdhdResponseMetrics(finalText, { wordCap, allowLeadingSessionTasks: true }),
      profile,
      finalText,
    );

    // `llm_rejected`: the model ran but its rewrite was not adopted (truncated,
    // over word cap, or no structural gain). Distinct from "none" — which means
    // we never needed the LLM — so telemetry can surface drafts shipped
    // non-compliant despite oversight (#714).
    const rewrittenOut = finalText !== trimmed;
    return {
      text: finalText,
      rewritten: rewrittenOut,
      method: useLlm ? "llm" : rewrittenOut ? "deterministic" : "llm_rejected",
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
    const fallback =
      requireDiagram && !hasEduaiDiagramFence(trimmed)
        ? ensureDiagramBeforeNext(trimmed, diagramOpts)
        : trimmed;
    return {
      text: fallback,
      rewritten: fallback !== trimmed,
      method: fallback !== trimmed ? "deterministic" : "llm_failed",
      beforeMetrics,
      afterMetrics: withProfileStructuralPass(
        computeAdhdResponseMetrics(fallback, { wordCap, allowLeadingSessionTasks: true }),
        profile,
        fallback,
      ),
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
