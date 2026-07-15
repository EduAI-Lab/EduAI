// @vitest-environment node

import { describe, it, expect } from "vitest";
import {
  capMaxOutputTokensForPrompt,
  estimateTokensFromChars,
  estimateToolDefinitionTokens,
  promptFitsContextWindow,
  resolveMaxOutputTokens,
  resolveModelContextWindow,
} from "~/lib/ai/providers.server";

describe("resolveModelContextWindow", () => {
  it("uses 16384 for vLLM when DB stores 8192", () => {
    expect(resolveModelContextWindow(8192, "vllm")).toBe(16384);
  });

  it("respects explicit large vLLM context values", () => {
    expect(resolveModelContextWindow(32768, "vllm")).toBe(32768);
  });
});

describe("resolveMaxOutputTokens", () => {
  it("defaults vLLM completion to 2048", () => {
    expect(resolveMaxOutputTokens(16384, "vllm")).toBe(2048);
  });

  it("does not treat vLLM DB value 8192 as completion budget", () => {
    expect(resolveMaxOutputTokens(8192, "vllm")).toBe(2048);
  });

  it("honours explicit small output limits", () => {
    expect(resolveMaxOutputTokens(1024, "vllm")).toBe(1024);
  });
});

describe("capMaxOutputTokensForPrompt", () => {
  it("shrinks completion when prompt fills the window", () => {
    expect(
      capMaxOutputTokensForPrompt({
        contextWindow: 16384,
        estimatedInputTokens: 8193,
        desiredMaxOutput: 8192,
      }),
    ).toBeLessThan(8192);
  });

  it("keeps at least minOutput when nearly full", () => {
    expect(
      capMaxOutputTokensForPrompt({
        contextWindow: 16384,
        estimatedInputTokens: 16000,
        desiredMaxOutput: 2048,
        minOutput: 256,
      }),
    ).toBe(256);
  });

  it("matches the reported failure case (8193 input, 8192 desired)", () => {
    const capped = capMaxOutputTokensForPrompt({
      contextWindow: 16384,
      estimatedInputTokens: 8193,
      desiredMaxOutput: 8192,
    });
    expect(8193 + capped).toBeLessThanOrEqual(16384);
  });

  it("caps below 2048 when admin tool schemas are reserved (16k window)", () => {
    // Observed LiteLLM failure: ~14337 real input + 2048 output > 16384.
    // With tool schemas in the estimate, headroom must drop below 2048.
    const estimatedWithoutTools = 4_000;
    const toolDefinitionTokens = estimateToolDefinitionTokens(17);
    const estimatedInputTokens = estimatedWithoutTools + toolDefinitionTokens;
    const capped = capMaxOutputTokensForPrompt({
      contextWindow: 16_384,
      estimatedInputTokens,
      desiredMaxOutput: 1024,
      toolDefinitionTokens: 0,
      safetyBuffer: 512,
    });
    expect(capped).toBeLessThanOrEqual(1024);
    expect(estimatedInputTokens + capped + 512).toBeLessThanOrEqual(16_384);
  });
});

describe("estimateToolDefinitionTokens", () => {
  it("scales with tool count", () => {
    expect(estimateToolDefinitionTokens(0)).toBe(0);
    expect(estimateToolDefinitionTokens(17)).toBe(256 + 17 * 420);
  });
});

describe("promptFitsContextWindow", () => {
  it("rejects the observed 16k overflow", () => {
    expect(
      promptFitsContextWindow({
        contextWindow: 16_384,
        estimatedInputTokens: 14_337,
        maxOutputTokens: 2048,
        safetyBuffer: 0,
      }),
    ).toBe(false);
  });

  it("accepts a capped completion for the same input", () => {
    expect(
      promptFitsContextWindow({
        contextWindow: 16_384,
        estimatedInputTokens: 14_337,
        maxOutputTokens: 1024,
        safetyBuffer: 256,
      }),
    ).toBe(true);
  });
});

describe("estimateTokensFromChars", () => {
  it("rounds up char counts", () => {
    expect(estimateTokensFromChars(8193 * 4)).toBe(8193);
  });
});
