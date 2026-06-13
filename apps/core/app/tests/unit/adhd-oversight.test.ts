// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import {
  ADHD_OVERSIGHT_REWRITE_SYSTEM,
  applyNextLineAnchor,
  auditAndMaybeRewrite,
  extractNextPromptCandidate,
  findLastInlineNextMatch,
  isAdhdOversightEnabled,
  isForwardContinuationOffer,
  isOversightEligibleDraft,
  tryDeterministicStructuralFix,
} from "~/lib/ai/adhd-oversight";
import {
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
  computeAdhdResponseMetrics,
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

  it("fixes archived S2-on turn 2 redirect turn", () => {
    const fixed = tryDeterministicStructuralFix(S2_ON_T2_ASSISTANT);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain("**Next?** Want to come back to the dishwashing steps first");
    expect(isStructuralCompliancePass(computeAdhdResponseMetrics(fixed!))).toBe(true);
  });

  it("returns null when no Next? candidate exists", () => {
    expect(tryDeterministicStructuralFix("Short answer without a question.")).toBeNull();
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

    const result = await auditAndMaybeRewrite({ draft: compliant, model: mockModel });
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
  });

  it("rejects LLM rewrite that improves structure but exceeds word cap", async () => {
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
    expect(result.method).toBe("none");
    expect(result.rewritten).toBe(false);
    expect(result.text).toBe(messy);
  });

  it("returns draft when LLM rewrite fails", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("provider down"));

    const messy = Array(300).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: messy, model: mockModel, wordCap: 250 });
    expect(result.method).toBe("llm_failed");
    expect(result.text).toBe(messy);
    expect(result.rewritten).toBe(false);
  });
});
