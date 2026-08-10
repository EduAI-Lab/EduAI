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

import { createAIProviderRegistry, listEnabledRegistryProviders } from "~/lib/ai/providers";

const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
const originalVllmUrl = process.env.VLLM_BASE_URL;
const originalVllmApiKey = process.env.VLLM_API_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  createOllamaMock.mockClear();
  createOpenAIMock.mockClear();
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalOllamaUrl;
  if (originalVllmUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmUrl;
  if (originalVllmApiKey === undefined) delete process.env.VLLM_API_KEY;
  else process.env.VLLM_API_KEY = originalVllmApiKey;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
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
    // VLLM_BASE_URL being set now disables the vllm-local fallback (#1268);
    // this test is about the SSRF baseURL guard, not key resolution, so give
    // it a real key rather than relying on the dev default.
    process.env.VLLM_API_KEY = "test-key";

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
});

describe("listEnabledRegistryProviders vllm key gate (#1268 review)", () => {
  it("excludes vllm when enabled but no key is available anywhere (production)", () => {
    delete process.env.VLLM_API_KEY;
    process.env.NODE_ENV = "production";

    const ids = listEnabledRegistryProviders({ vllm: { isEnabled: true } });

    expect(ids).not.toContain("vllm");
  });

  it("includes vllm when the user settings supply an apiKey", () => {
    delete process.env.VLLM_API_KEY;
    process.env.NODE_ENV = "production";

    const ids = listEnabledRegistryProviders({
      vllm: { isEnabled: true, apiKey: "real-secret" },
    });

    expect(ids).toContain("vllm");
  });

  it("includes vllm when VLLM_API_KEY is set in the environment", () => {
    process.env.VLLM_API_KEY = "real-secret";
    process.env.NODE_ENV = "production";

    const ids = listEnabledRegistryProviders({ vllm: { isEnabled: true } });

    expect(ids).toContain("vllm");
  });

  it("falls back to the dev default key outside production, matching createAIProviderRegistry", () => {
    delete process.env.VLLM_API_KEY;
    process.env.NODE_ENV = "development";

    const ids = listEnabledRegistryProviders({ vllm: { isEnabled: true } });

    expect(ids).toContain("vllm");
  });

  it("excludes vllm when not enabled, regardless of key availability", () => {
    process.env.VLLM_API_KEY = "real-secret";

    const ids = listEnabledRegistryProviders({ vllm: { isEnabled: false } });

    expect(ids).not.toContain("vllm");
  });
});
