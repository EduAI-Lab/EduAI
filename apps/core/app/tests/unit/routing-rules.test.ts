import { describe, it, expect, afterEach } from "vitest";
import {
  isShortFactualPrompt,
  matchPhase1Rules,
  routingDefaultTier,
} from "~/lib/ai/routing/rules";

const baseCtx = {
  prompt: "Explain the midterm grading rubric in detail.",
  imagesPresent: false,
  courseId: "course-1",
};

describe("isShortFactualPrompt", () => {
  it("matches short what-is prompts under 120 chars", () => {
    const prompt = "What is gradient descent?";
    expect(isShortFactualPrompt(prompt, prompt.toLowerCase())).toBe(true);
  });

  it("rejects long prompts even with factual prefix", () => {
    const prompt = `What is ${"x".repeat(120)}`;
    expect(isShortFactualPrompt(prompt, prompt.toLowerCase())).toBe(false);
  });
});

describe("matchPhase1Rules", () => {
  it("rule 1: images route to tier >= 2 with image support", () => {
    const match = matchPhase1Rules({ ...baseCtx, imagesPresent: true });
    expect(match.rule).toBe("rule1_images_tier_ge_2");
    expect(match.pick).toMatchObject({ kind: "minTier", minTier: 2, requireImages: true });
  });

  it("rule 3: short factual prompts use tier 1", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "What is a binary tree?",
    });
    expect(match.rule).toBe("rule3_short_factual_tier_1");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  it("rule 3: who-won / what-was prompts use tier 1 when short", () => {
    expect(
      matchPhase1Rules({ ...baseCtx, prompt: "Who won the 2026 world cup?" }).rule,
    ).toBe("rule3_short_factual_tier_1");
    expect(
      matchPhase1Rules({ ...baseCtx, prompt: "What was the final score?" }).rule,
    ).toBe("rule3_short_factual_tier_1");
  });

  it("rule 3b: course + courseRagNeeded uses tier 1 even without RAG hits", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Who beat Morocco in the final?",
      courseRagNeeded: true,
      ragChunkCount: 0,
    });
    expect(match.rule).toBe("rule3b_course_rag_tier_1");
  });

  it("rule 3b: course RAG hits with courseRagNeeded use tier 1", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Who beat Morocco in the final?",
      courseRagNeeded: true,
      ragTopSimilarity: 0.72,
      ragChunkCount: 4,
    });
    expect(match.rule).toBe("rule3b_course_rag_tier_1");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  it("does not route web-search phrasing to a separate tools rule", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Search the web for the latest syllabus updates",
    });
    expect(match.rule).not.toBe("rule2_tools_tier_ge_2");
    expect(match.rule).toBe("rule6_default_tier_1_energy");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  it("rule 4: strong RAG hits use tier 1 (any chunk count)", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      ragTopSimilarity: 0.91,
      ragChunkCount: 4,
    });
    expect(match.rule).toBe("rule4_strong_rag_tier_1");
  });

  it("rule 4b: moderate RAG with course uses tier 1", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      ragTopSimilarity: 0.7,
      ragChunkCount: 2,
    });
    expect(match.rule).toBe("rule4b_moderate_rag_tier_1");
  });

  it("rule 5: heavy RAG context uses default tier (1 by default)", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      ragTopSimilarity: 0.4,
      ragChunkCount: 5,
      ragContextTokenEstimate: 2500,
    });
    expect(match.rule).toBe("rule5_long_rag_tier_1_energy");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  it("rule 6: default path prefers tier 1 (7B)", () => {
    const match = matchPhase1Rules(baseCtx);
    expect(match.rule).toBe("rule6_default_tier_1_energy");
    expect(match.pick).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  describe("ROUTING_DEFAULT_TIER=2 legacy", () => {
    afterEach(() => {
      delete process.env.ROUTING_DEFAULT_TIER;
    });

    it("uses tier 2 for default and long RAG when explicitly configured", () => {
      process.env.ROUTING_DEFAULT_TIER = "2";
      expect(routingDefaultTier()).toBe(2);
      expect(matchPhase1Rules(baseCtx).rule).toBe("rule6_default_tier_2_carbon");
    });
  });

  it("images win over other signals when attachments present", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      imagesPresent: true,
      prompt: "Summarize this chart from the syllabus",
    });
    expect(match.rule).toBe("rule1_images_tier_ge_2");
  });
});
