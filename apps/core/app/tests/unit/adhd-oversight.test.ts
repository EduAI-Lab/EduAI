// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import {
  auditAndMaybeRewrite,
  isAdhdOversightEnabled,
  tryDeterministicStructuralFix,
} from "~/lib/ai/adhd-oversight";

const S1_ON_DRAFT = `Gradient descent is like **walking down a hill blindfolded** to find the lowest point. In machine learning, it's an algorithm that helps a model learn by **adjusting its parameters** (like the steps you take) to minimize errors (reaching the bottom of the hill). It repeatedly moves in the direction of the **steepest decline** until it finds the best possible set of parameters, where the errors are as small as they can get.

Next? Want to know how it's used in practice?`;

const mockModel = { modelId: "mock" } as never;

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

describe("tryDeterministicStructuralFix", () => {
  it("fixes the archived S1-on drift case without an LLM", () => {
    const fixed = tryDeterministicStructuralFix(S1_ON_DRAFT);
    expect(fixed).not.toBeNull();
    expect(fixed!.startsWith("**Top summary**")).toBe(true);
    expect(/\*\*Next\?\*\*/.test(fixed!.split(/\r?\n/).slice(-3).join("\n"))).toBe(true);
  });

  it("returns null when draft is empty", () => {
    expect(tryDeterministicStructuralFix("   ")).toBeNull();
  });
});

describe("auditAndMaybeRewrite", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
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
    const result = await auditAndMaybeRewrite({ draft: S1_ON_DRAFT, model: mockModel });
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
    } as never);

    const messy = Array(300).fill("word").join(" ");
    const result = await auditAndMaybeRewrite({ draft: messy, model: mockModel, wordCap: 250 });
    expect(result.method).toBe("llm");
    expect(generateText).toHaveBeenCalledOnce();
  });
});
