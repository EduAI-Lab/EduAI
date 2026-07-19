import { describe, it, expect, afterEach } from "vitest";
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

  it("enables vllm from server env when chat model is vllm:* (ignores client isEnabled false)", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "vllm:qwen2.5-7b-instruct",
    );
    expect(merged.vllm?.isEnabled).toBe(true);
    expect(merged.vllm?.baseUrl).toBe("http://cmps01.ok.ubc.ca:8001");
  });

  it("enables ollama from server env when chat model is ollama:*", () => {
    process.env.OLLAMA_BASE_URL = "http://cmps01.ok.ubc.ca:11434";
    const merged = mergeLocalInferenceFromEnv(
      { ollama: { isEnabled: false } },
      "ollama:qwen2.5:7b",
    );
    expect(merged.ollama?.isEnabled).toBe(true);
    expect(merged.ollama?.baseUrl).toBe("http://cmps01.ok.ubc.ca:11434");
  });

  it("does not enable vllm without env URL", () => {
    delete process.env.VLLM_BASE_URL;
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "vllm:qwen2.5-7b-instruct",
    );
    expect(merged.vllm?.isEnabled).toBe(false);
  });

  it("does not touch local providers when chat model is cloud-only", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "openai:gpt-4o",
    );
    expect(merged.vllm?.isEnabled).toBe(false);
  });

  it("uses fleet override URL when provided", () => {
    delete process.env.VLLM_BASE_URL;
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "vllm:qwen2.5-7b-instruct",
      "http://cmps02.ok.ubc.ca:8001",
    );
    expect(merged.vllm?.isEnabled).toBe(true);
    expect(merged.vllm?.baseUrl).toBe("http://cmps02.ok.ubc.ca:8001");
  });

  it("enables all local providers with env when no model id is passed", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    process.env.OLLAMA_BASE_URL = "http://cmps01.ok.ubc.ca:11434";
    const merged = mergeLocalInferenceFromEnv({});
    expect(merged.vllm?.isEnabled).toBe(true);
    expect(merged.ollama?.isEnabled).toBe(true);
  });

  it("uses fleet vLLM base URL override when provided", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    const merged = mergeLocalInferenceFromEnv(
      { vllm: { isEnabled: false } },
      "vllm:qwen2.5-7b-instruct",
      "http://cmps02.ok.ubc.ca:8001",
    );
    expect(merged.vllm?.baseUrl).toBe("http://cmps02.ok.ubc.ca:8001");
  });
});
