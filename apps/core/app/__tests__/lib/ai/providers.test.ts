import { describe, it, expect } from "vitest";
import {
  PROVIDER_CONFIGS,
  validateProviderConfig,
  getAvailableProviders,
  getProviderConfig,
  isProviderConfigured,
  getModelIdentifier,
  parseModelIdentifier,
} from "~/lib/ai/providers";

describe("PROVIDER_CONFIGS", () => {
  it("includes the three supported providers", () => {
    expect(Object.keys(PROVIDER_CONFIGS).sort()).toEqual([
      "google",
      "ollama",
      "openai",
    ]);
  });

  it("marks ollama as not requiring an API key", () => {
    expect(PROVIDER_CONFIGS.ollama.requiresApiKey).toBe(false);
    expect(PROVIDER_CONFIGS.openai.requiresApiKey).toBe(true);
    expect(PROVIDER_CONFIGS.google.requiresApiKey).toBe(true);
  });

  it("declares an envVarName for every provider", () => {
    for (const id of ["openai", "google", "ollama"] as const) {
      expect(PROVIDER_CONFIGS[id].envVarName).toBeTruthy();
    }
  });
});

describe("validateProviderConfig", () => {
  it("rejects unsupported providers", () => {
    // @ts-expect-error -- intentionally passing an invalid id
    const r = validateProviderConfig("unknown", {});
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Unsupported provider");
  });

  it("requires an API key for providers that need one", () => {
    const r = validateProviderConfig("openai", {});
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("API key is required for this provider");
  });

  it("does not require an API key for ollama", () => {
    expect(validateProviderConfig("ollama", {}).isValid).toBe(true);
  });

  it("accepts a configured provider", () => {
    expect(validateProviderConfig("openai", { apiKey: "sk-x" }).isValid).toBe(true);
    expect(validateProviderConfig("google", { apiKey: "g-x" }).isValid).toBe(true);
  });
});

describe("getAvailableProviders", () => {
  it("returns every configured provider", () => {
    const ids = getAvailableProviders().map((p) => p.id).sort();
    expect(ids).toEqual(["google", "ollama", "openai"]);
  });
});

describe("getProviderConfig", () => {
  it("returns the config for a known provider", () => {
    expect(getProviderConfig("openai")?.id).toBe("openai");
  });

  it("returns null for unknown providers", () => {
    // @ts-expect-error -- intentionally passing an invalid id
    expect(getProviderConfig("nope")).toBeNull();
  });
});

describe("isProviderConfigured", () => {
  it("returns false when the provider is not enabled", () => {
    expect(isProviderConfigured("openai", { openai: { isEnabled: false } })).toBe(false);
  });

  it("returns false when an API key is missing for a key-requiring provider", () => {
    expect(isProviderConfigured("openai", { openai: { isEnabled: true } })).toBe(false);
  });

  it("returns true when enabled and a key is provided", () => {
    expect(
      isProviderConfigured("openai", { openai: { isEnabled: true, apiKey: "sk-x" } }),
    ).toBe(true);
  });

  it("returns true for ollama when only enabled", () => {
    expect(isProviderConfigured("ollama", { ollama: { isEnabled: true } })).toBe(true);
  });

  it("returns false for ollama when not enabled", () => {
    expect(isProviderConfigured("ollama", { ollama: { isEnabled: false } })).toBe(false);
  });

  it("returns false when the provider key is missing entirely", () => {
    expect(isProviderConfigured("openai", {})).toBe(false);
  });
});

describe("getModelIdentifier", () => {
  it("joins provider and model with a colon", () => {
    expect(getModelIdentifier("openai", "gpt-4o")).toBe("openai:gpt-4o");
    expect(getModelIdentifier("ollama", "llama3")).toBe("ollama:llama3");
  });
});

describe("parseModelIdentifier", () => {
  it("parses a standard identifier", () => {
    expect(parseModelIdentifier("openai:gpt-4o")).toEqual({
      providerId: "openai",
      modelId: "gpt-4o",
    });
  });

  it("preserves additional colons in the model id", () => {
    expect(parseModelIdentifier("ollama:gpt-oss:120b")).toEqual({
      providerId: "ollama",
      modelId: "gpt-oss:120b",
    });
  });

  it("returns null when there is no colon", () => {
    expect(parseModelIdentifier("openai-gpt-4o")).toBeNull();
  });

  it("returns null for an unknown provider", () => {
    expect(parseModelIdentifier("foo:bar")).toBeNull();
  });

  it("returns null for empty or malformed input", () => {
    expect(parseModelIdentifier("")).toBeNull();
    expect(parseModelIdentifier(":bar")).toBeNull();
    expect(parseModelIdentifier("openai:")).toBeNull();
  });

  it("returns null for non-string input", () => {
    // @ts-expect-error -- testing the runtime type guard
    expect(parseModelIdentifier(null)).toBeNull();
    // @ts-expect-error -- testing the runtime type guard
    expect(parseModelIdentifier(undefined)).toBeNull();
  });
});
