// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderV1 } from "@ai-sdk/provider";
import type { GoogleGenerativeAIProviderSettings } from "@ai-sdk/google";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import type { OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import type { OllamaProviderSettings } from "ollama-ai-provider";

const { createOpenAICompatibleMock, createOpenAIMock, createGoogleMock, createOllamaMock } =
  vi.hoisted(() => ({
    createOpenAICompatibleMock: vi.fn((_options: OpenAICompatibleProviderSettings) => vi.fn()),
    createOpenAIMock: vi.fn((_options: OpenAIProviderSettings) => vi.fn()),
    createGoogleMock: vi.fn((_options: GoogleGenerativeAIProviderSettings) => vi.fn()),
    createOllamaMock: vi.fn((_options: OllamaProviderSettings) => vi.fn()),
  }));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (options: OpenAICompatibleProviderSettings) =>
    createOpenAICompatibleMock(options),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (options: OpenAIProviderSettings) => createOpenAIMock(options),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: (options: GoogleGenerativeAIProviderSettings) =>
    createGoogleMock(options),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: (options: OllamaProviderSettings) => createOllamaMock(options),
}));
vi.mock("ai", () => ({
  createProviderRegistry: (providers: Record<string, ProviderV1>) => ({ __providers: providers }),
}));

import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  OPENCODE_BASE_URL,
} from "~/lib/ai/providers";
import type { SupportedProvider, UserProviderSettings } from "~/lib/ai/providers";

/** The providers map the `ai` mock echoes back, so a test can assert what was registered. */
type MockedRegistry = { __providers: Partial<Record<SupportedProvider, ProviderV1>> };

/**
 * SAFETY: `createProviderRegistry` is mocked above to return `{ __providers }`,
 * so the registry is that echo shape, not the real `ProviderRegistryProvider`.
 */
function buildRegistry(settings: UserProviderSettings): MockedRegistry {
  return createAIProviderRegistry(settings) as unknown as MockedRegistry;
}

describe("OpenCode provider registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs the dedicated provider with the fixed endpoint and Bearer key source", () => {
    const registry = buildRegistry({
      opencode: {
        isEnabled: true,
        apiKey: "opencode-secret",
        baseUrl: "https://attacker.example.invalid/v1",
      },
    });

    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: "opencode",
      baseURL: OPENCODE_BASE_URL,
      apiKey: "opencode-secret",
    });
    expect(createOpenAICompatibleMock.mock.calls[0][0].baseURL).toBe(
      "https://opencode.ai/zen/go/v1",
    );
    expect(registry.__providers.opencode).toBeDefined();
    expect(
      listEnabledRegistryProviders({
        opencode: { isEnabled: true, apiKey: "opencode-secret" },
      }),
    ).toEqual(["opencode"]);
  });

  it("does not register OpenCode without an enabled key", () => {
    const registry = buildRegistry({
      opencode: { isEnabled: false, apiKey: "opencode-secret" },
    });
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
    expect(registry.__providers.opencode).toBeUndefined();
    expect(
      listEnabledRegistryProviders({
        opencode: { isEnabled: false, apiKey: "opencode-secret" },
      }),
    ).toEqual([]);
  });
});
