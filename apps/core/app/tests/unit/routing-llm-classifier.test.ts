import { describe, it, expect, afterEach } from "vitest";
import {
  tierFromLlmClassification,
  type LlmRouteClassification,
} from "~/lib/ai/routing/llm-classifier";

describe("tierFromLlmClassification", () => {
  const base: LlmRouteClassification = {
    task: "chat",
    complexity: "low",
    confidence: 90,
  };

  afterEach(() => {
    delete process.env.ROUTING_LLM_MIN_CONFIDENCE;
    delete process.env.VLLM_BASE_URL;
  });

  it("maps low complexity with high confidence to tier 1", () => {
    expect(tierFromLlmClassification(base)).toBe(1);
  });

  it("maps medium complexity to tier 3 on local vLLM", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification({ ...base, complexity: "medium" }),
    ).toBe(3);
  });

  it("bumps to tier 3 when confidence is below threshold", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    process.env.ROUTING_LLM_MIN_CONFIDENCE = "80";
    expect(
      tierFromLlmClassification({ ...base, complexity: "low", confidence: 50 }),
    ).toBe(3);
  });

  it("maps high complexity to tier 3", () => {
    expect(
      tierFromLlmClassification({ ...base, complexity: "high" }),
    ).toBe(3);
  });
});
