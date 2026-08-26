// @vitest-environment node

import { describe, it, expect, afterEach } from "vitest";
import {
  capMaxOutputTokensForPrompt,
  DEFAULT_CONTEXT_FILL_RATIO,
  estimateTokensFromChars,
  estimateToolDefinitionTokens,
  estimateAdminToolStepReserve,
  promptFitsContextWindow,
  resolveContextFillRatio,
  resolveMaxOutputTokens,
  resolveModelContextWindow,
  resolveSessionCharBudgetForModel,
  ESTIMATED_CHARS_PER_TOKEN,
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

  it("leaves room for multi-step tool results on 16k delete→list flows", () => {
    const base =
      estimateTokensFromChars(8_000) +
      estimateToolDefinitionTokens(17) +
      estimateAdminToolStepReserve(16_384);
    const capped = capMaxOutputTokensForPrompt({
      contextWindow: 16_384,
      estimatedInputTokens: base,
      desiredMaxOutput: 512,
      toolDefinitionTokens: 0,
      safetyBuffer: 512,
      minOutput: 256,
    });
    expect(base + capped + 512).toBeLessThanOrEqual(16_384);
    expect(capped).toBeLessThanOrEqual(512);
  });
});

describe("estimateToolDefinitionTokens", () => {
  it("scales with tool count", () => {
    expect(estimateToolDefinitionTokens(0)).toBe(0);
    expect(estimateToolDefinitionTokens(17)).toBe(256 + 17 * 420);
  });
});

describe("estimateAdminToolStepReserve", () => {
  it("reserves headroom on small context windows", () => {
    expect(estimateAdminToolStepReserve(16_384)).toBe(3_500);
    expect(estimateAdminToolStepReserve(32_768)).toBe(2_000);
    expect(estimateAdminToolStepReserve(128_000)).toBe(0);
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

describe("resolveContextFillRatio (#1639)", () => {
  const original = process.env.CHAT_CONTEXT_FILL_RATIO;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_CONTEXT_FILL_RATIO;
    } else {
      process.env.CHAT_CONTEXT_FILL_RATIO = original;
    }
  });

  it("defaults to 0.9 when unset", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    expect(resolveContextFillRatio()).toBe(DEFAULT_CONTEXT_FILL_RATIO);
    expect(DEFAULT_CONTEXT_FILL_RATIO).toBe(0.9);
  });

  it("lets a per-model override win over the env default", () => {
    process.env.CHAT_CONTEXT_FILL_RATIO = "0.8";
    expect(resolveContextFillRatio(0.75)).toBe(0.75);
  });

  it("falls back to the env value when no per-model override is set", () => {
    process.env.CHAT_CONTEXT_FILL_RATIO = "0.85";
    expect(resolveContextFillRatio(null)).toBe(0.85);
  });

  it("clamps out-of-range values into the allowed band", () => {
    expect(resolveContextFillRatio(2)).toBe(0.98);
    expect(resolveContextFillRatio(0.1)).toBe(0.5);
  });

  it("ignores a non-finite or non-positive value", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    expect(resolveContextFillRatio(0)).toBe(DEFAULT_CONTEXT_FILL_RATIO);
    expect(resolveContextFillRatio(Number.NaN)).toBe(DEFAULT_CONTEXT_FILL_RATIO);
  });
});

describe("resolveSessionCharBudgetForModel (#1639)", () => {
  const original = process.env.CHAT_CONTEXT_FILL_RATIO;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_CONTEXT_FILL_RATIO;
    } else {
      process.env.CHAT_CONTEXT_FILL_RATIO = original;
    }
  });

  it("bounds history to (ratio*window - reservations) in chars", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    // 16384 * 0.9 = 14745 input tokens; minus safety(256) with no other reserves.
    const budget = resolveSessionCharBudgetForModel({ contextWindow: 16_384 });
    const expectedTokens = Math.floor(16_384 * 0.9) - 256;
    expect(budget).toBe(expectedTokens * ESTIMATED_CHARS_PER_TOKEN);
  });

  it("reserves the system prompt, RAG, tool schemas and tool steps", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    const withReserves = resolveSessionCharBudgetForModel({
      contextWindow: 16_384,
      systemChars: 4_000,
      ragChars: 8_000,
      toolCount: 10,
      reserveToolSteps: true,
    });
    const bare = resolveSessionCharBudgetForModel({ contextWindow: 16_384 });
    // Every reservation shrinks the history budget.
    expect(withReserves).toBeLessThan(bare);
    expect(withReserves).toBeGreaterThan(0);
  });

  it("gives history exactly the input budget the reservations leave (#1643)", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    // History is never inflated past what the window leaves: with only ~200
    // tokens of the input budget unreserved, history gets those ~200 tokens —
    // not a fixed floor that would push the assembled prompt over the window.
    const inputTokens = Math.floor(16_384 * 0.9); // 14745
    const remainingTokens = 200;
    const systemChars = (inputTokens - 256 - remainingTokens) * ESTIMATED_CHARS_PER_TOKEN;
    const budget = resolveSessionCharBudgetForModel({ contextWindow: 16_384, systemChars });
    expect(budget).toBe(remainingTokens * ESTIMATED_CHARS_PER_TOKEN);
  });

  it("yields history to zero when reservations exceed the input budget (#1643)", () => {
    // A fixed prompt larger than the window must drive history to zero rather
    // than force an over-context request; the route's fit-check then fails closed.
    const budget = resolveSessionCharBudgetForModel({
      contextWindow: 16_384,
      systemChars: 500_000,
      toolCount: 50,
      reserveToolSteps: true,
    });
    expect(budget).toBe(0);
  });

  it("honors a per-model ratio override", () => {
    delete process.env.CHAT_CONTEXT_FILL_RATIO;
    const tighter = resolveSessionCharBudgetForModel({
      contextWindow: 32_768,
      perModelRatio: 0.6,
    });
    const looser = resolveSessionCharBudgetForModel({ contextWindow: 32_768 });
    expect(tighter).toBeLessThan(looser);
  });
});
