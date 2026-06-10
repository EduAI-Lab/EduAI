// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  computeAdhdResponseMetrics,
  isStructuralCompliancePass,
  withStructuralPass,
} from "~/lib/ai/adhd-metrics";

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

  it("fails when Next? is inline but not in the last three lines as a marked block", () => {
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
