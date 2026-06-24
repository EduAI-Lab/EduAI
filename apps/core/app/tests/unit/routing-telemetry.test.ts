import { describe, expect, it } from "vitest";
import {
  coalesceTokenUsage,
  normalizeTokenUsage,
} from "~/lib/ai/routing/telemetry";

describe("normalizeTokenUsage", () => {
  it("maps OpenAI-compatible snake_case fields", () => {
    expect(
      normalizeTokenUsage({
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
      }),
    ).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    });
  });

  it("treats all-zero usage as missing (vLLM stream without include_usage)", () => {
    expect(
      normalizeTokenUsage({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }),
    ).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it("coalesce skips zero-only sources", () => {
    expect(
      coalesceTokenUsage(
        { promptTokens: 0, completionTokens: 0 },
        { prompt_tokens: 10, completion_tokens: 5 },
      ),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });
});
