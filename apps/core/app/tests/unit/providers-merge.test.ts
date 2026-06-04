import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mergeLocalInferenceFromEnv } from "~/lib/ai/provider-types";

describe("mergeLocalInferenceFromEnv", () => {
  const originalVllm = process.env.VLLM_BASE_URL;
  const originalOllama = process.env.OLLAMA_BASE_URL;

  afterEach(() => {
    if (originalVllm === undefined) delete process.env.VLLM_BASE_URL;
    else process.env.VLLM_BASE_URL = originalVllm;
    if (originalOllama === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalOllama;
  });

  it("enables vllm from env when chat model is vllm:… even if Settings sent isEnabled false", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "vllm:qwen2.5-7b-instruct",
    );
    expect(merged.vllm?.isEnabled).toBe(true);
    expect(merged.vllm?.baseUrl).toBe("http://cmps01.ok.ubc.ca:8001");
  });

  it("does not enable vllm without env URL when explicitly disabled", () => {
    delete process.env.VLLM_BASE_URL;
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "openai:gpt-4o",
    );
    expect(merged.vllm?.isEnabled).toBeFalsy();
  });
});
