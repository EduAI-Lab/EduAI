// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  computeAdhdResponseMetrics,
  isProfileStructuralPass,
  isRedirectTemplatePass,
  isStructuralCompliancePass,
  resolveAdhdResponseWordCap,
  withStructuralPass,
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_CLARIFICATION_USER_WORD_THRESHOLD,
  ADHD_TUTORING_WORD_CAP,
} from "~/lib/ai/adhd-metrics";
import { S2_ON_T2_ASSISTANT } from "~/tests/fixtures/adhd-baseline-transcripts";

describe("computeAdhdResponseMetrics", () => {
  it("detects literal Top summary and Next? anchors", () => {
    const text = `**Top summary**
- One bullet

**Next?** Want more?`;

    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.topSummary).toBe(true);
    expect(metrics.nextLine).toBe(true);
    expect(metrics.underCap).toBe(true);
    expect(isStructuralCompliancePass(metrics)).toBe(true);
  });

  it("fails when Next? anchor lacks bold markers", () => {
    const text = `Gradient descent is like walking down a hill.

Next? Want to know more?`;

    const metrics = computeAdhdResponseMetrics(text);
    expect(metrics.topSummary).toBe(false);
    expect(metrics.nextLine).toBe(false);
    expect(isStructuralCompliancePass(metrics)).toBe(false);
  });

  it("respects a custom word cap", () => {
    const text = "one two three four five";
    expect(computeAdhdResponseMetrics(text, { wordCap: 3 }).underCap).toBe(false);
    expect(computeAdhdResponseMetrics(text, { wordCap: 5 }).underCap).toBe(true);
  });

  it("adds structuralPass via withStructuralPass", () => {
    const metrics = withStructuralPass({
      wordCount: 10,
      topSummary: true,
      nextLine: true,
      underCap: true,
      oneTopic: null,
    });
    expect(metrics.structuralPass).toBe(true);
  });
});

describe("resolveAdhdResponseWordCap", () => {
  it("uses clarification cap for short follow-up turns", () => {
    const short = Array(ADHD_CLARIFICATION_USER_WORD_THRESHOLD).fill("word").join(" ");
    expect(resolveAdhdResponseWordCap(short)).toBe(ADHD_CLARIFICATION_WORD_CAP);
  });

  it("uses tutoring cap for longer user turns", () => {
    const long = Array(ADHD_CLARIFICATION_USER_WORD_THRESHOLD + 1).fill("word").join(" ");
    expect(resolveAdhdResponseWordCap(long)).toBe(ADHD_TUTORING_WORD_CAP);
  });

  it("treats ≤20-word user turns as clarification context per policy §3 heuristic", () => {
    expect(ADHD_CLARIFICATION_USER_WORD_THRESHOLD).toBe(20);
  });
});

describe("isProfileStructuralPass", () => {
  it("requires Top summary for full tutoring", () => {
    const metrics = computeAdhdResponseMetrics("Plain paragraph answer.");
    expect(isProfileStructuralPass(metrics, "full_tutoring", "Plain paragraph answer.")).toBe(
      false,
    );
  });

  it("passes S2 redirect fixture without Top summary", () => {
    const metrics = computeAdhdResponseMetrics(S2_ON_T2_ASSISTANT, {
      wordCap: ADHD_CLARIFICATION_WORD_CAP,
    });
    expect(isRedirectTemplatePass(metrics, S2_ON_T2_ASSISTANT)).toBe(true);
    expect(isProfileStructuralPass(metrics, "redirect", S2_ON_T2_ASSISTANT)).toBe(true);
    expect(isStructuralCompliancePass(metrics)).toBe(false);
  });

  it("passes greeting drafts that are under cap without structure", () => {
    const text = "Hello! How can I help you today?";
    const metrics = computeAdhdResponseMetrics(text, { wordCap: 80 });
    expect(isProfileStructuralPass(metrics, "greeting", text)).toBe(true);
  });
});
