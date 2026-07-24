// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import {
  ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS,
  ADHD_OVERSIGHT_REWRITE_SYSTEM,
  ADHD_OVERSIGHT_REWRITE_TOKENS_PER_WORD,
  applyNextLineAnchor,
  auditAndMaybeRewrite,
  buildOverseenAssistantMessagesToPersist,
  buildOversightRewriteSystem,
  extractNextPromptCandidate,
  findLastInlineNextMatch,
  isAdhdOversightEnabled,
  isForwardContinuationOffer,
  isOversightEligibleDraft,
  resolveOversightRewriteMaxTokens,
  tryDeterministicStructuralFix,
} from "~/lib/ai/adhd-oversight";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  computeAdhdResponseMetrics,
  isProfileStructuralPass,
  isStructuralCompliancePass,
} from "~/lib/ai/adhd-metrics";
import {
  S1_ON_ASSISTANT,
  S2_ON_T2_ASSISTANT,
  S3_ON_T1_ASSISTANT,
} from "~/tests/fixtures/adhd-baseline-transcripts";

const mockModel = { modelId: "mock" } as never;

describe("ADHD_OVERSIGHT_REWRITE_SYSTEM", () => {
  it("references shared word-cap constants instead of hardcoded values", () => {
    expect(ADHD_OVERSIGHT_REWRITE_SYSTEM).toContain(
      `Hard cap ${ADHD_TUTORING_WORD_CAP} words for tutoring answers; ${ADHD_CLARIFICATION_WORD_CAP} for brief clarifications.`,
    );
  });
});

describe("buildOversightRewriteSystem (redirect / v2.0 A/B/C flag)", () => {
  it("targets the A/B/C topic-switch template for the redirect profile", () => {
    const system = buildOversightRewriteSystem("redirect", ADHD_CLARIFICATION_WORD_CAP);
    expect(system).toContain("Looks like a topic switch");
    expect(system).toContain("**A)**");
    expect(system).toContain("**B)**");
    expect(system).toContain("**C)**");
    expect(system).toContain('Do NOT add a "Top summary" block');
    expect(system).toContain("<current task>");
    expect(system).not.toContain("<current active task>");
  });

  it("instructs the Dean to preserve a Session Tasks checklist instead of dropping it (redirect and full_tutoring)", () => {
    const redirectSystem = buildOversightRewriteSystem("redirect", ADHD_CLARIFICATION_WORD_CAP);
    expect(redirectSystem).toContain("Session Tasks");

    const tutoringSystem = buildOversightRewriteSystem("full_tutoring", ADHD_TUTORING_WORD_CAP);
    expect(tutoringSystem).toContain("Session Tasks");
  });
});

describe("isAdhdOversightEnabled", () => {
  const original = process.env.ADHD_ASSIST_OVERSIGHT;

  afterEach(() => {
    if (original === undefined) delete process.env.ADHD_ASSIST_OVERSIGHT;
    else process.env.ADHD_ASSIST_OVERSIGHT = original;
  });

  it("defaults to enabled", () => {
    delete process.env.ADHD_ASSIST_OVERSIGHT;
    expect(isAdhdOversightEnabled()).toBe(true);
  });

  it("respects explicit disable values", () => {
    process.env.ADHD_ASSIST_OVERSIGHT = "false";
    expect(isAdhdOversightEnabled()).toBe(false);
  });
});

describe("isOversightEligibleDraft", () => {
  it("rejects empty and non-prose drafts", () => {
    expect(isOversightEligibleDraft("")).toBe(false);
    expect(isOversightEligibleDraft("   ")).toBe(false);
    expect(isOversightEligibleDraft("{}")).toBe(false);
  });

  it("accepts normal assistant prose", () => {
    expect(isOversightEligibleDraft("Hello world")).toBe(true);
  });
});

describe("extractNextPromptCandidate", () => {
  it("preserves redirect questions from baseline S2 turn 2", () => {
    expect(extractNextPromptCandidate(S2_ON_T2_ASSISTANT)).toBe(
      "Want to come back to the dishwashing steps first, or switch now to learn about marginal income tax brackets?",
    );
  });

  it("ignores pedagogical comprehension questions at the end", () => {
    const text = `**Top summary**
- Point one

Do you understand why this matters?`;
    expect(extractNextPromptCandidate(text)).toBeNull();
  });

  it("ignores Next?-prefixed comprehension checks", () => {
    expect(
      extractNextPromptCandidate("Next? Do you understand why this matters?"),
    ).toBeNull();
  });

  it("accepts policy-style forward continuation offers", () => {
    expect(extractNextPromptCandidate("Ready to try one yourself?")).toBe(
      "Ready to try one yourself?",
    );
  });
});

describe("isForwardContinuationOffer", () => {
  it("accepts redirect and Next? continuation prompts", () => {
    expect(isForwardContinuationOffer("Want to come back to dishwashing first?")).toBe(true);
    expect(isForwardContinuationOffer("Next? Want me to expand step 2?")).toBe(true);
  });

  it("rejects comprehension-check questions", () => {
    expect(isForwardContinuationOffer("Do you understand why this matters?")).toBe(false);
    expect(isForwardContinuationOffer("Next? Do you understand why this matters?")).toBe(
      false,
    );
  });

  it("rejects near-miss offers that lack forward-continuation phrasing", () => {
    expect(isForwardContinuationOffer("Can you explain that again?")).toBe(false);
    expect(isForwardContinuationOffer("What is marginal tax?")).toBe(false);
  });
});

describe("findLastInlineNextMatch", () => {
  it("returns the last inline Next? prompt when multiple appear", () => {
    const draft = `Quoted prior turn: Next? old prompt here

**Top summary**
- New answer

Next? Want to continue with step 2?`;
    const match = findLastInlineNextMatch(draft);
    expect(match?.prompt).toBe("Want to continue with step 2?");
    expect(match?.body).toContain("Next? old prompt here");
  });
});

describe("applyNextLineAnchor", () => {
  it("promotes S2 redirect without generic filler", () => {
    const fixed = applyNextLineAnchor(S2_ON_T2_ASSISTANT);
    expect(fixed).toContain("**Next?** Want to come back to the dishwashing steps first");
    expect(fixed).not.toContain("Want me to expand on any part of this");
  });

  it("uses the last inline Next? when multiple appear in the draft", () => {
    const draft = `Quoted prior turn: Next? old prompt here

**Top summary**
- New answer

Next? Want to continue with step 2?`;
    const fixed = applyNextLineAnchor(draft);
    expect(fixed).toContain("**Next?** Want to continue with step 2?");
    expect(fixed).toContain("Next? old prompt here");
  });

  it("does not promote pedagogical questions to Next? anchors", () => {
    const draft = `**Top summary**
- Key point

Do you understand why this matters?`;
    expect(applyNextLineAnchor(draft)).toBeNull();
  });

  it("does not promote Next?-prefixed comprehension checks", () => {
    const draft = `**Top summary**
- Key point

Next? Do you understand why this matters?`;
    expect(applyNextLineAnchor(draft)).toBeNull();
  });

  it("falls through to a trailing forward offer when the last inline Next? is a comprehension check", () => {
    const draft = `Quoted prior turn: Next? Do you understand the old topic?

**Top summary**
- New answer

Want to continue with step 2?`;
    const fixed = applyNextLineAnchor(draft);
    expect(fixed).toContain("**Next?** Want to continue with step 2?");
    expect(fixed).toContain("Next? Do you understand the old topic?");
  });

  it("does not promote statements ending without a question mark", () => {
    const draft = `**Top summary**
- Key point

Want to continue with step 2.`;
    expect(applyNextLineAnchor(draft)).toBeNull();
  });
});

describe("tryDeterministicStructuralFix", () => {
  it("fixes archived S1-on drift without an LLM", () => {
    const fixed = tryDeterministicStructuralFix(S1_ON_ASSISTANT);
    expect(fixed).not.toBeNull();
    expect(fixed!.startsWith("**Top summary**")).toBe(true);
    expect(isStructuralCompliancePass(computeAdhdResponseMetrics(fixed!))).toBe(true);
  });

  it("fixes archived S3-on turn 1", () => {
    const fixed = tryDeterministicStructuralFix(S3_ON_T1_ASSISTANT);
    expect(fixed).not.toBeNull();
    expect(isStructuralCompliancePass(computeAdhdResponseMetrics(fixed!))).toBe(true);
  });

  it("passes redirect drafts without Top summary when profile is redirect", () => {
    const fixed = tryDeterministicStructuralFix(S2_ON_T2_ASSISTANT, {
      profile: "redirect",
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(fixed).not.toBeNull();
    expect(fixed!.startsWith("**Top summary**")).toBe(false);
    const metrics = computeAdhdResponseMetrics(fixed!, { wordCap: ADHD_CLARIFICATION_WORD_CAP });
    expect(isProfileStructuralPass(metrics, "redirect", fixed!)).toBe(true);
  });

  it("fixes archived S2-on turn 2 redirect turn (legacy global path)", () => {
    const fixed = tryDeterministicStructuralFix(S2_ON_T2_ASSISTANT);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain("**Next?** Want to come back to the dishwashing steps first");
    expect(isStructuralCompliancePass(computeAdhdResponseMetrics(fixed!))).toBe(true);
  });

  it("returns null when no Next? candidate exists", () => {
    expect(tryDeterministicStructuralFix("Short answer without a question.")).toBeNull();
  });

  it("returns null when only comprehension-check Next? anchors exist", () => {
    const draft = `**Top summary**
- Key point

Next? Do you understand why this matters?`;
    expect(tryDeterministicStructuralFix(draft)).toBeNull();
  });
});

describe("buildOverseenAssistantMessagesToPersist", () => {
  it("replaces only the final assistant message content with overseen text", () => {
    const messages = [
      { id: "tool-1", role: "assistant", content: [{ type: "tool-call" }] },
      { id: "final-1", role: "assistant", content: "draft without anchors" },
      { id: "user-1", role: "user", content: "hi" },
    ];
    const persisted = buildOverseenAssistantMessagesToPersist(
      messages,
      "**Top summary**\n- Fixed\n\n**Next?** Continue?",
    );
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toEqual(messages[0]);
    expect(persisted[1]).toMatchObject({
      id: "final-1",
      role: "assistant",
      content: "**Top summary**\n- Fixed\n\n**Next?** Continue?",
    });
  });

  it("creates a synthetic assistant message when response.messages is empty", () => {
    const persisted = buildOverseenAssistantMessagesToPersist(undefined, "overseen", {
      generateId: () => "synthetic-id",
    });
    expect(persisted).toEqual([
      { id: "synthetic-id", role: "assistant", content: "overseen" },
    ]);
  });

  it("returns assistant messages unchanged when overseen text is empty", () => {
    const messages = [{ id: "tool-1", role: "assistant", content: "tool step" }];
    expect(buildOverseenAssistantMessagesToPersist(messages, "")).toEqual(messages);
  });
});

describe("resolveOversightRewriteMaxTokens", () => {
  it("scales the cap with the word cap so long rewrites are not truncated (#714)", () => {
    expect(resolveOversightRewriteMaxTokens(250)).toBe(
      250 * ADHD_OVERSIGHT_REWRITE_TOKENS_PER_WORD,
    );
    expect(resolveOversightRewriteMaxTokens(250)).toBeGreaterThan(
      ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS,
    );
  });

  it("never drops below the floor for small clarification/redirect caps", () => {
    expect(resolveOversightRewriteMaxTokens(80)).toBe(ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS);
    expect(resolveOversightRewriteMaxTokens(0)).toBe(ADHD_OVERSIGHT_MIN_REWRITE_MAX_TOKENS);
  });
});

describe("auditAndMaybeRewrite", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
  });

  it("preserves ineligible draft text without emptying response", async () => {
    const result = await auditAndMaybeRewrite({ draft: "{}", model: mockModel });
    expect(result.text).toBe("{}");
    expect(result.method).toBe("none");
    expect(result.rewritten).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("passes through structurally compliant drafts", async () => {
    const compliant = `**Top summary**
- One point

**Next?** More?`;

    const result = await auditAndMaybeRewrite({
      draft: compliant,
      model: mockModel,
      profile: "full_tutoring",
    });
    expect(result.rewritten).toBe(false);
    expect(result.method).toBe("none");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips Dean rewrite for greeting profile", async () => {
    const greeting = "Hello! How can I help you today?";
    const result = await auditAndMaybeRewrite({
      draft: greeting,
      model: mockModel,
      profile: "greeting",
      wordCap: 80,
    });
    expect(result.rewritten).toBe(false);
    expect(result.method).toBe("none");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("passes redirect drafts that already meet profile rules", async () => {
    const result = await auditAndMaybeRewrite({
      draft: S2_ON_T2_ASSISTANT,
      model: mockModel,
      profile: "redirect",
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(result.rewritten).toBe(false);
    expect(result.method).toBe("none");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("passes a compliant v2.0 A/B/C topic-switch draft without a Dean call", async () => {
    const draft = `Looks like a topic switch. We were working on **defining the API contract**. Want to:
**A)** Finish defining the API contract first, then come back to this
**B)** Add this to the todo list and stay on defining the API contract
**C)** Switch now (I'll save progress on defining the API contract)`;

    const result = await auditAndMaybeRewrite({
      draft,
      model: mockModel,
      profile: "redirect",
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(result.rewritten).toBe(false);
    expect(result.method).toBe("none");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("uses deterministic fix for S1-on baseline drift", async () => {
    const result = await auditAndMaybeRewrite({ draft: S1_ON_ASSISTANT, model: mockModel });
    expect(result.rewritten).toBe(true);
    expect(result.method).toBe("deterministic");
    expect(result.afterMetrics.structuralPass).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("falls back to LLM rewrite when deterministic fix is insufficient", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: `**Top summary**
- Still on topic

**Next?** Continue?`,
      usage: { promptTokens: 10, completionTokens: 20 },
    } as never);

    const messy = Array(300).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: messy, model: mockModel, wordCap: 250 });
    expect(result.method).toBe("llm");
    expect(result.oversightDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.oversightUsage?.completionTokens).toBe(20);
    expect(generateText).toHaveBeenCalledOnce();
    // #714: the output budget must scale with wordCap, not a fixed 1024.
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      maxTokens: resolveOversightRewriteMaxTokens(250),
    });
  });

  it("flags LLM rewrite that improves structure but exceeds word cap as llm_rejected", async () => {
    const longBody = Array(280).fill("word").join(" ");
    vi.mocked(generateText).mockResolvedValue({
      text: `**Top summary**
- Point

**Next?** Continue?

${longBody}`,
      usage: { promptTokens: 10, completionTokens: 20 },
    } as never);

    const messy = Array(300).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: messy, model: mockModel, wordCap: 250 });
    // #714: the LLM ran but its rewrite was not adopted — distinct from "none".
    expect(result.method).toBe("llm_rejected");
    expect(result.rewritten).toBe(false);
    expect(result.text).toBe(messy);
  });

  it("does not silently ship the original when a long-draft rewrite is truncated (#714)", async () => {
    // Simulate a truncated rewrite of a long draft: the output budget runs out
    // before the **Next?** anchor lands, so the partial rewrite is still over
    // the word cap and fails profile validation.
    const truncated = `**Top summary**
- Restating the draft ${Array(300).fill("word").join(" ")}`;
    vi.mocked(generateText).mockResolvedValue({
      text: truncated,
      usage: { promptTokens: 600, completionTokens: 1024 },
    } as never);

    const longDraft = Array(800).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: longDraft, model: mockModel, wordCap: 250 });
    // The original non-compliant draft is still returned, but the method makes
    // the rejected rewrite observable instead of indistinguishable from "none".
    expect(result.method).toBe("llm_rejected");
    expect(result.rewritten).toBe(false);
    expect(result.text).toBe(longDraft);
    expect(result.afterMetrics.structuralPass).toBe(false);
  });

  it("returns draft when LLM rewrite fails", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("provider down"));

    const messy = Array(300).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: messy, model: mockModel, wordCap: 250 });
    expect(result.method).toBe("llm_failed");
    expect(result.text).toBe(messy);
    expect(result.rewritten).toBe(false);
  });

  it("rewrites a structurally valid draft that still contains urgency language", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: `**Top summary**
- Take your time with this step.

**Next?** Want to try step one?`,
      usage: { promptTokens: 8, completionTokens: 12 },
    } as never);

    const urgent = `**Top summary**
- Do this quickly before the exam.

**Next?** Want to try step one?`;
    const result = await auditAndMaybeRewrite({
      draft: urgent,
      model: mockModel,
      profile: "full_tutoring",
    });
    expect(result.rewritten).toBe(true);
    expect(result.method).toBe("llm");
    expect(result.afterMetrics.noUrgency).toBe(true);
    expect(result.text).not.toMatch(/quickly/i);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects an LLM rewrite that still contains urgency, keeping the draft", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: `**Top summary**
- Still do this quickly.

**Next?** Want to try step one?`,
      usage: { promptTokens: 8, completionTokens: 12 },
    } as never);

    const urgent = `**Top summary**
- Do this quickly before the exam.

**Next?** Want to try step one?`;
    const result = await auditAndMaybeRewrite({
      draft: urgent,
      model: mockModel,
      profile: "full_tutoring",
    });
    expect(result.rewritten).toBe(false);
    // The LLM ran but its rewrite was rejected (still urgent), so this is
    // `llm_rejected`, not `none` — #714 distinguishes the two for telemetry.
    expect(result.method).toBe("llm_rejected");
    expect(result.text).toBe(urgent);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("does not let requireDiagram bypass Top summary / Next? structure", async () => {
    // Diagram-only rewrite: has a fence but no Top summary / Next? anchors.
    vi.mocked(generateText).mockResolvedValue({
      text: `Here is a diagram:

\`\`\`eduai-diagram
process-flow
title: Steps
One: First
Two: Second
\`\`\`
`,
      usage: { promptTokens: 8, completionTokens: 20 },
    } as never);

    const draft = `**Top summary**
- Existing point without a diagram

**Next?** Want the diagram?`;
    const result = await auditAndMaybeRewrite({
      draft,
      model: mockModel,
      profile: "full_tutoring",
      userText: "Can you draw a diagram of the steps?",
    });

    // LLM ran (diagram was missing), but rewrite lacked structure → rejected.
    expect(generateText).toHaveBeenCalledOnce();
    expect(result.method).not.toBe("llm");
    // Saved reply must still expose Top summary + Next? (profile structure).
    expect(result.text).toMatch(/\*\*Top summary\*\*/i);
    expect(result.text).toMatch(/\*\*Next\?\*\*/);
    expect(
      isProfileStructuralPass(
        computeAdhdResponseMetrics(result.text),
        "full_tutoring",
        result.text,
      ),
    ).toBe(true);
  });

  it("does not force a diagram into a compliant redirect flag when the off-topic message also asks for one", async () => {
    // The learner's off-topic message embeds a diagram request ("switch to a
    // diagram of X"), which must NOT make the Dean answer the new topic -
    // the A/B/C flag withholds it entirely (policy §5).
    const abcFlag = `Looks like a topic switch. We were working on **the essay outline**. Want to:
**A)** Finish the essay outline first, then come back to this
**B)** Add this to the todo list and stay on the essay outline
**C)** Switch now (I'll save progress on the essay outline)`;

    const result = await auditAndMaybeRewrite({
      draft: abcFlag,
      model: mockModel,
      profile: "redirect",
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
      userText: "wait actually, can we switch and draw a diagram of gradient descent instead?",
    });

    expect(result.rewritten).toBe(false);
    expect(result.method).toBe("none");
    expect(generateText).not.toHaveBeenCalled();
  });
});
