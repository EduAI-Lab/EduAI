import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateOpenAI = vi.fn(() => ({ languageModel: vi.fn() }));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import {
  createAIProviderRegistry,
  getModelIdentifier,
  parseModelIdentifier,
  validateProviderConfig,
  isProviderConfigured,
  getAvailableProviders,
  PROVIDER_CONFIGS,
} from "~/lib/ai/providers";

describe("parseModelIdentifier", () => {
  it("parses openrouter models with slashes in model id", () => {
    expect(parseModelIdentifier("openrouter:google/gemini-2.5-flash")).toEqual({
      providerId: "openrouter",
      modelId: "google/gemini-2.5-flash",
    });
  });

  it("parses ollama models with extra colons in model id", () => {
    expect(parseModelIdentifier("ollama:gpt-oss:120b")).toEqual({
      providerId: "ollama",
      modelId: "gpt-oss:120b",
    });
  });

  it("returns null for unknown providers", () => {
    expect(parseModelIdentifier("anthropic:claude-3")).toBeNull();
  });

  it("returns null when separator is missing", () => {
    expect(parseModelIdentifier("openrouter-google-gemini")).toBeNull();
  });
});

describe("getModelIdentifier", () => {
  it("builds openrouter identifiers", () => {
    expect(getModelIdentifier("openrouter", "openai/gpt-4o")).toBe(
      "openrouter:openai/gpt-4o",
    );
  });
});

describe("validateProviderConfig", () => {
  it("requires an api key for openrouter", () => {
    expect(validateProviderConfig("openrouter", {})).toEqual({
      isValid: false,
      error: "API key is required for this provider",
    });
    expect(validateProviderConfig("openrouter", { apiKey: "sk-or-test" })).toEqual({
      isValid: true,
    });
  });
});

describe("isProviderConfigured", () => {
  it("treats openrouter as configured only when enabled with a key", () => {
    expect(
      isProviderConfigured("openrouter", {
        openrouter: { isEnabled: true, apiKey: "sk-or-test" },
      }),
    ).toBe(true);
    expect(
      isProviderConfigured("openrouter", {
        openrouter: { isEnabled: true },
      }),
    ).toBe(false);
  });
});

describe("getAvailableProviders", () => {
  it("includes openrouter in provider metadata", () => {
    const ids = getAvailableProviders().map((p) => p.id);
    expect(ids).toContain("openrouter");
    expect(PROVIDER_CONFIGS.openrouter.envVarName).toBe("OPENROUTER_API_KEY");
  });
});

describe("createAIProviderRegistry", () => {
  beforeEach(() => {
    mockCreateOpenAI.mockClear();
    delete process.env.OPENROUTER_HTTP_REFERER;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.OPENROUTER_APP_TITLE;
  });

  it("wires openrouter through the OpenAI-compatible client", () => {
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.OPENROUTER_APP_TITLE = "EduAI Test";

    createAIProviderRegistry({
      openrouter: { isEnabled: true, apiKey: "sk-or-test" },
    });

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-or-test",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "EduAI Test",
      },
    });
  });

  it("skips openrouter when disabled or missing a key", () => {
    createAIProviderRegistry({
      openrouter: { isEnabled: false, apiKey: "sk-or-test" },
    });
    createAIProviderRegistry({
      openrouter: { isEnabled: true },
    });
    expect(mockCreateOpenAI).not.toHaveBeenCalled();
  });
});
