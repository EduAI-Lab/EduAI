// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const { createOllamaMock, createOpenAIMock } = vi.hoisted(() => ({
  createOllamaMock: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
  createOpenAIMock: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: (opts: Record<string, unknown>) => createOllamaMock(opts),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: Record<string, unknown>) => createOpenAIMock(opts),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => vi.fn(),
}));

vi.mock("ai", () => ({
  createProviderRegistry: (providers: unknown) => ({ __providers: providers }),
}));

import { createAIProviderRegistry } from "~/lib/ai/providers";

const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
const originalVllmUrl = process.env.VLLM_BASE_URL;
const originalVllmEmbeddingUrl = process.env.VLLM_EMBEDDING_BASE_URL;

afterEach(() => {
  createOllamaMock.mockClear();
  createOpenAIMock.mockClear();
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalOllamaUrl;
  if (originalVllmUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmUrl;
  if (originalVllmEmbeddingUrl === undefined) delete process.env.VLLM_EMBEDDING_BASE_URL;
  else process.env.VLLM_EMBEDDING_BASE_URL = originalVllmEmbeddingUrl;
});

describe("createAIProviderRegistry SSRF guard (issue #972)", () => {
  it("ignores a malicious client-supplied ollama baseUrl (cloud metadata) and falls back to the server default", () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.internal.example.edu:11434";

    createAIProviderRegistry({
      ollama: { isEnabled: true, baseUrl: "http://169.254.169.254/latest/meta-data" },
    });

    expect(createOllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://ollama.internal.example.edu:11434/api" }),
    );
  });

  it("allows an ollama baseUrl on loopback", () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.internal.example.edu:11434";

    createAIProviderRegistry({
      ollama: { isEnabled: true, baseUrl: "http://127.0.0.1:11434" },
    });

    expect(createOllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:11434/api" }),
    );
  });

  it("ignores a malicious client-supplied vllm baseUrl and falls back to the server default", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu:8001";

    createAIProviderRegistry({
      vllm: { isEnabled: true, baseUrl: "http://169.254.169.254/latest/meta-data" },
    });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://vllm.internal.example.edu:8001/v1" }),
    );
  });

  it("does not attach an Authorization-bearing header set for a client-supplied ollama baseUrl", () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.internal.example.edu:11434";

    createAIProviderRegistry({
      ollama: { isEnabled: true, baseUrl: "http://127.0.0.1:11434" },
    });

    expect(createOllamaMock).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
  });

  it("allows the configured CMPS embedding endpoint host", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    process.env.VLLM_EMBEDDING_BASE_URL = "http://cmps01.ok.ubc.ca:8001/v1";

    createAIProviderRegistry({
      vllm: { isEnabled: true, baseUrl: "http://cmps01.ok.ubc.ca:8001/v1" },
    });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://cmps01.ok.ubc.ca:8001/v1" }),
    );
  });
});
