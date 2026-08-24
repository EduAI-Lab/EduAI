// @vitest-environment node
//
// Covers app/lib/ai/providers.ts. providers-ssrf.server.test.ts and
// providers-vllm-thinking.server.test.ts already exercise the vLLM/Ollama SSRF
// guard and the thinking-mode fetch wrapper in depth, so this file focuses on
// what they don't: the OpenAI/Google branches, the already-suffixed
// baseURL branches, the vLLM API-key fallback chain, the "both resolutions
// fail -> provider disabled" branch of resolveLocalInferenceBaseUrlOrLog, and
// the plain data/lookup helpers (validateProviderConfig, getAvailableProviders,
// getProviderConfig, isProviderConfigured, getModelIdentifier,
// listEnabledRegistryProviders).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderV1 } from "@ai-sdk/provider";
import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import type { OllamaProviderSettings } from "ollama-ai-provider";
import type { BedrockProviderConfig } from "~/lib/ai/routing/bedrock/bedrock-provider.server";

const {
  createOllamaMock,
  createOpenAIMock,
  createGoogleMock,
  createBedrockMock,
  resolveOllamaMock,
} = vi.hoisted(() => ({
  createOllamaMock: vi.fn((_opts: OllamaProviderSettings) => vi.fn()),
  createOpenAIMock: vi.fn((_opts: OpenAIProviderSettings) => vi.fn()),
  createGoogleMock: vi.fn((_opts: GoogleGenerativeAIProviderSettings) => vi.fn()),
  createBedrockMock: vi.fn((opts: BedrockProviderConfig) => ({ __bedrock: opts })),
  resolveOllamaMock: vi.fn(),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: (opts: OllamaProviderSettings) => createOllamaMock(opts),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: OpenAIProviderSettings) => createOpenAIMock(opts),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: (opts: GoogleGenerativeAIProviderSettings) => createGoogleMock(opts),
}));

/**
 * The registry mock echoes the providers map back under `__providers` so each
 * test can assert which providers `createAIProviderRegistry` actually built,
 * which the real `ProviderRegistryProvider` does not expose.
 */
type MockedRegistry = { __providers: Partial<Record<SupportedProvider, ProviderV1>> };

vi.mock("ai", () => ({
  createProviderRegistry: (providers: Record<string, ProviderV1>) => ({ __providers: providers }),
}));

vi.mock("~/lib/ai/routing/bedrock/bedrock-provider.server", () => ({
  createBedrockProvider: (opts: BedrockProviderConfig) => createBedrockMock(opts),
}));

// Defaults to the real implementation; the "resolution fully fails" test below
// overrides it to always throw, exercising the double-catch branch of
// resolveLocalInferenceBaseUrlOrLog (both the client-supplied and the
// deployment-default resolution fail -> the provider is disabled).
vi.mock("~/lib/ai/ollama-url.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/ollama-url.server")>();
  resolveOllamaMock.mockImplementation(actual.resolveAllowedOllamaBaseUrl);
  return { ...actual, resolveAllowedOllamaBaseUrl: resolveOllamaMock };
});

import {
  createAIProviderRegistry,
  getAvailableProviders,
  getModelIdentifier,
  getProviderConfig,
  isProviderConfigured,
  listEnabledRegistryProviders,
  validateProviderConfig,
} from "~/lib/ai/providers";
import type { SupportedProvider, UserProviderSettings } from "~/lib/ai/providers";

/**
 * Builds a registry and reads it back as the mock's echo shape.
 *
 * SAFETY: the `ai` mock above replaces `createProviderRegistry` with one
 * returning `{ __providers }`, so this value is a `MockedRegistry` rather than
 * the opaque `ProviderRegistryProvider` the real signature promises.
 */
function buildRegistry(settings: UserProviderSettings): MockedRegistry {
  return createAIProviderRegistry(settings) as unknown as MockedRegistry;
}

const ENV_KEYS = [
  "OLLAMA_BASE_URL",
  "VLLM_BASE_URL",
  "VLLM_API_KEY",
  "VLLM_FLEET_HEAVY_URL",
  "VLLM_FLEET_CHAT_URLS",
  "AWS_BEARER_TOKEN_BEDROCK",
  "BEDROCK_REGION",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function stashEnv() {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
}
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

describe("createAIProviderRegistry", () => {
  stashEnv();

  afterEach(() => {
    createOllamaMock.mockClear();
    createOpenAIMock.mockClear();
    createGoogleMock.mockClear();
    createBedrockMock.mockClear();
    restoreEnv();
  });

  it("creates an OpenAI client when enabled with an API key", () => {
    const registry = buildRegistry({
      openai: { isEnabled: true, apiKey: "sk-abc" },
    });

    expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-abc" });
    expect(registry.__providers.openai).toBeDefined();
  });

  it("does not create an OpenAI client when enabled but missing an API key", () => {
    const registry = buildRegistry({
      openai: { isEnabled: true },
    });

    expect(createOpenAIMock).not.toHaveBeenCalled();
    expect(registry.__providers.openai).toBeUndefined();
  });

  it("does not create an OpenAI client when it has a key but is not enabled", () => {
    createAIProviderRegistry({ openai: { isEnabled: false, apiKey: "sk-abc" } });
    expect(createOpenAIMock).not.toHaveBeenCalled();
  });

  it("creates a Google client when enabled with an API key", () => {
    const registry = buildRegistry({
      google: { isEnabled: true, apiKey: "goog-key" },
    });

    expect(createGoogleMock).toHaveBeenCalledWith({ apiKey: "goog-key" });
    expect(registry.__providers.google).toBeDefined();
  });

  it("does not create a Google client when missing an API key", () => {
    createAIProviderRegistry({ google: { isEnabled: true } });
    expect(createGoogleMock).not.toHaveBeenCalled();
  });

  it("does not append /api to an Ollama base URL that already ends with it", () => {
    process.env.OLLAMA_BASE_URL = "http://cmps01.ok.ubc.ca:11434/api";

    createAIProviderRegistry({ ollama: { isEnabled: true } });

    expect(createOllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://cmps01.ok.ubc.ca:11434/api" }),
    );
  });

  it("does not append /v1 to a vLLM base URL that already ends with it", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001/v1";
    process.env.VLLM_API_KEY = "env-key";

    createAIProviderRegistry({ vllm: { isEnabled: true } });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://cmps01.ok.ubc.ca:8001/v1" }),
    );
  });

  it("uses the user-supplied vLLM API key when present", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    delete process.env.VLLM_API_KEY;

    createAIProviderRegistry({ vllm: { isEnabled: true, apiKey: "user-supplied-key" } });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "user-supplied-key" }),
    );
  });

  it("falls back to VLLM_API_KEY from env when no user key is supplied", () => {
    process.env.VLLM_BASE_URL = "http://cmps01.ok.ubc.ca:8001";
    process.env.VLLM_API_KEY = "env-key";

    createAIProviderRegistry({ vllm: { isEnabled: true } });

    expect(createOpenAIMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "env-key" }));
  });

  it("uses the 'vllm-local' default API key for a loopback vLLM instance", () => {
    process.env.VLLM_BASE_URL = "http://127.0.0.1:8001";
    delete process.env.VLLM_API_KEY;

    createAIProviderRegistry({ vllm: { isEnabled: true } });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "vllm-local" }),
    );
  });

  it("registers nothing when no provider settings are enabled", () => {
    const registry = buildRegistry({});

    expect(createOpenAIMock).not.toHaveBeenCalled();
    expect(createGoogleMock).not.toHaveBeenCalled();
    expect(createOllamaMock).not.toHaveBeenCalled();
    expect(Object.keys(registry.__providers)).toHaveLength(0);
  });

  it("creates a Bedrock client only when enabled and the env token is present", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    process.env.BEDROCK_REGION = "us-west-2";

    const registry = buildRegistry({
      bedrock: { isEnabled: true, apiKey: "client-key", baseUrl: "https://evil.example" },
    });

    expect(createBedrockMock).toHaveBeenCalledWith({
      apiKey: "env-token",
      region: "us-west-2",
    });
    expect(registry.__providers.bedrock).toBeDefined();
  });

  it("does not create a Bedrock client when enabled but the env token is missing", () => {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    createAIProviderRegistry({ bedrock: { isEnabled: true } });
    expect(createBedrockMock).not.toHaveBeenCalled();
  });

  it("does not create a Bedrock client when the env token is present but it is not enabled", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    createAIProviderRegistry({ bedrock: { isEnabled: false } });
    expect(createBedrockMock).not.toHaveBeenCalled();
  });
});

describe("createAIProviderRegistry — resolution fully fails", () => {
  const realResolveOllama = resolveOllamaMock.getMockImplementation();

  afterEach(() => {
    createOllamaMock.mockClear();
    resolveOllamaMock.mockImplementation(realResolveOllama!);
  });

  it("disables the provider (no client created) when both the client and default base URL resolutions throw", () => {
    resolveOllamaMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const registry = buildRegistry({ ollama: { isEnabled: true } });

    expect(createOllamaMock).not.toHaveBeenCalled();
    expect(registry.__providers.ollama).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("OLLAMA_BASE_URL is misconfigured"),
    );
    errorSpy.mockRestore();
  });
});

describe("validateProviderConfig", () => {
  it("is invalid for an unsupported provider id", () => {
    const result = validateProviderConfig("unknown" as SupportedProvider, {});
    expect(result).toEqual({ isValid: false, error: "Unsupported provider" });
  });

  it("is invalid when the provider requires a key and none is given", () => {
    const result = validateProviderConfig("openai", {});
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/api key is required/i);
  });

  it("is valid when a required API key is present", () => {
    expect(validateProviderConfig("openai", { apiKey: "sk-x" })).toEqual({ isValid: true });
  });

  it("is valid for a provider that does not require an API key, even without one", () => {
    expect(validateProviderConfig("ollama", {})).toEqual({ isValid: true });
  });
});

describe("getAvailableProviders / getProviderConfig", () => {
  it("returns all known provider configs", () => {
    const configs = getAvailableProviders();
    expect(configs.map((c) => c.id).sort()).toEqual([
      "google",
      "ollama",
      "openai",
      "opencode",
      "vllm",
    ]);
  });

  it("returns the config for a known provider id", () => {
    expect(getProviderConfig("vllm")?.name).toBe("vLLM");
  });

  it("returns null for an unknown provider id", () => {
    expect(getProviderConfig("unknown" as SupportedProvider)).toBeNull();
  });
});

describe("isProviderConfigured", () => {
  it("is false when the provider is not enabled", () => {
    const settings: UserProviderSettings = { openai: { isEnabled: false, apiKey: "sk-x" } };
    expect(isProviderConfigured("openai", settings)).toBe(false);
  });

  it("is false when enabled but missing a required API key", () => {
    const settings: UserProviderSettings = { openai: { isEnabled: true } };
    expect(isProviderConfigured("openai", settings)).toBe(false);
  });

  it("is true when enabled with a required API key", () => {
    const settings: UserProviderSettings = { openai: { isEnabled: true, apiKey: "sk-x" } };
    expect(isProviderConfigured("openai", settings)).toBe(true);
  });

  it("is true for a local provider enabled without an API key", () => {
    const settings: UserProviderSettings = { ollama: { isEnabled: true } };
    expect(isProviderConfigured("ollama", settings)).toBe(true);
  });

  it("is false when the provider is absent from settings entirely", () => {
    expect(isProviderConfigured("openai", {})).toBe(false);
  });
});

describe("getModelIdentifier", () => {
  it("joins providerId and modelId with a colon", () => {
    expect(getModelIdentifier("openai", "gpt-4o")).toBe("openai:gpt-4o");
  });
});

describe("listEnabledRegistryProviders", () => {
  it("returns an empty array when nothing is enabled", () => {
    expect(listEnabledRegistryProviders({})).toEqual([]);
  });

  it("includes openai/google only when enabled with a key, and ollama/vllm whenever enabled", () => {
    const settings: UserProviderSettings = {
      openai: { isEnabled: true, apiKey: "sk-x" },
      google: { isEnabled: true }, // no key -> excluded
      ollama: { isEnabled: true },
      vllm: { isEnabled: true },
    };
    expect(listEnabledRegistryProviders(settings).sort()).toEqual(["ollama", "openai", "vllm"]);
  });

  it("includes bedrock only when enabled and AWS_BEARER_TOKEN_BEDROCK is set", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    expect(listEnabledRegistryProviders({ bedrock: { isEnabled: true } })).toEqual(["bedrock"]);

    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    expect(listEnabledRegistryProviders({ bedrock: { isEnabled: true } })).toEqual([]);
  });
});
