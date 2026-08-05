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

  it("rule 2b: debug prompts escalate to tier 3", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      courseId: null,
      prompt:
        "Debug this code: `for i in range(10): print(i); i = i + 1` — why might the loop behave unexpectedly?",
    });
    expect(match.rule).toBe("rule2b_debug_tier_3");
  });

  it("rule 2c: complex code tasks escalate to tier 3", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      courseId: null,
      prompt: "Write a Python function that returns the nth Fibonacci number iteratively.",
    });
    expect(match.rule).toBe("rule2c_complex_task_tier_3");
  });

  it("rule 2d: RAG-reasoning phrasing uses tier 3 before strong-RAG tier-1 shortcut", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Which factor was NOT a driver of Britain's early Industrial Revolution?",
      ragTopSimilarity: 0.88,
      ragChunkCount: 4,
    });
    expect(match.rule).toBe("rule2d_rag_reasoning_tier_3");
  });

  it("generic web-search phrasing without lookup cues stays on default tier 1", () => {
    const match = matchPhase1Rules({
      ...baseCtx,
      prompt: "Search the web for the latest syllabus updates",
    });
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

  describe("strict-oracle under-route fixes (10 prompts)", () => {
    const underRoutePrompts = [
      {
        id: "ts-028",
        prompt: "Write a Python function that returns the nth Fibonacci number iteratively.",
        ctx: { courseId: null },
        expectedRule: "rule2c_complex_task_tier_3",
      },
      {
        id: "ts-037",
        prompt:
          "Debug this code: `for i in range(10): print(i); i = i + 1` — why might the loop behave unexpectedly?",
        ctx: { courseId: null },
        expectedRule: "rule2b_debug_tier_3",
      },
      {
        id: "ts-044",
        prompt: "Walk through Dijkstra's algorithm on a small 5-node graph example.",
        ctx: { ragTopSimilarity: 0.9, ragChunkCount: 4 },
        expectedRule: "rule2c_complex_task_tier_3",
      },
      {
        id: "ts-083",
        prompt: "Which factor was NOT a driver of Britain's early Industrial Revolution?",
        ctx: { ragTopSimilarity: 0.88, ragChunkCount: 4 },
        expectedRule: "rule2d_rag_reasoning_tier_3",
      },
      {
        id: "ts-094",
        prompt:
          "Walk through one partition step of quicksort on [3, 6, 8, 10, 1, 2, 1] using the last element as pivot.",
        ctx: { courseId: null },
        expectedRule: "rule2c_complex_task_tier_3",
      },
      {
        id: "ts-113",
        prompt:
          "A React component uses eight useEffect hooks with overlapping dependencies—outline a refactor strategy without changing behavior.",
        ctx: { courseId: null },
        expectedRule: "rule2c_complex_task_tier_3",
      },
      {
        id: "ts-119",
        prompt:
          "Give an example that violates the Liskov substitution principle and show a corrected design.",
        ctx: { ragTopSimilarity: 0.91, ragChunkCount: 3 },
        expectedRule: "rule2d_rag_reasoning_tier_3",
      },
      {
        id: "ts-080",
        prompt: "Name two distinct functions of the endoplasmic reticulum.",
        ctx: {
          courseId: "course-biol",
          courseRagNeeded: true,
          ragTopSimilarity: 0.88,
          ragChunkCount: 4,
        },
        expectedRule: "rule2e_distinct_enumeration_tier_3",
      },
    ] as const;

    it.each(underRoutePrompts)("$id routes to tier 3 via $expectedRule", ({ prompt, ctx, expectedRule }) => {
      const match = matchPhase1Rules({
        ...baseCtx,
        prompt,
        ...ctx,
      });
      expect(match.rule).toBe(expectedRule);
      expect(match.pick).toMatchObject({ kind: "exactTier", tier: 3 });
    });
  });
});
