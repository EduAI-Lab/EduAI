// @vitest-environment node

import { describe, it, expect } from "vitest";
import { resolveMaxOutputTokens } from "~/lib/ai/providers.server";

describe("resolveMaxOutputTokens", () => {
  it("caps vLLM output when DB stores context window (16384)", () => {
    expect(resolveMaxOutputTokens(16384, "vllm")).toBe(4096);
  });

  it("caps large DB values that look like context length", () => {
    expect(resolveMaxOutputTokens(32000, "vllm")).toBe(4096);
  });

  it("uses explicit smaller DB output limits", () => {
    expect(resolveMaxOutputTokens(2048, "vllm")).toBe(2048);
  });

  it("defaults vLLM to 4096 when DB maxTokens is unset", () => {
    expect(resolveMaxOutputTokens(null, "vllm")).toBe(4096);
  });
});
