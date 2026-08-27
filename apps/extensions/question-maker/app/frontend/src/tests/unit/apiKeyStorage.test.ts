/**
 * Unit tests for `apiKeyStorage` (#1546): AES-GCM encrypted localStorage helper
 * for AI provider keys, plus the provider-classification helpers used by the
 * AI-services status hooks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiKeyStorage,
  isCloudProvider,
  isCampusProvider,
  CLOUD_PROVIDERS,
} from "@/services/apiKeyStorage";

beforeEach(() => {
  localStorage.clear();
  apiKeyStorage.setAuthenticatedUser("test-user");
});

afterEach(() => {
  apiKeyStorage.setAuthenticatedUser(null);
  localStorage.clear();
});

describe("isCloudProvider / isCampusProvider", () => {
  it("classifies known cloud providers", () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(isCloudProvider(p)).toBe(true);
    }
  });

  it("rejects unknown or empty provider strings", () => {
    expect(isCloudProvider("vllm")).toBe(false);
    expect(isCloudProvider(null)).toBe(false);
    expect(isCloudProvider(undefined)).toBe(false);
    expect(isCloudProvider("")).toBe(false);
  });

  it("classifies vllm and legacy ollama as campus providers", () => {
    expect(isCampusProvider("vllm")).toBe(true);
    expect(isCampusProvider("ollama")).toBe(true);
    expect(isCampusProvider("google")).toBe(false);
    expect(isCampusProvider(null)).toBe(false);
  });
});

describe("apiKeyStorage encrypt/decrypt round-trip", () => {
  it("stores and retrieves a key, encrypted at rest", async () => {
    await apiKeyStorage.setApiKey("openai", "sk-test-123");

    const raw = localStorage.getItem("eduai_api_key_v2:test-user:openai");
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("sk-test-123");

    const retrieved = await apiKeyStorage.getApiKey("openai");
    expect(retrieved).toBe("sk-test-123");
  });

  it("returns null for a provider with no stored key", async () => {
    expect(await apiKeyStorage.getApiKey("anthropic")).toBeNull();
  });

  it("removeApiKey deletes the stored entry", async () => {
    await apiKeyStorage.setApiKey("google", "g-key");
    apiKeyStorage.removeApiKey("google");
    expect(await apiKeyStorage.getApiKey("google")).toBeNull();
  });

  it("getAllApiKeys returns only providers that have a stored key", async () => {
    await apiKeyStorage.setApiKey("openai", "k1");
    await apiKeyStorage.setApiKey("deepseek", "k2");

    const all = await apiKeyStorage.getAllApiKeys();
    expect(all).toEqual({ openai: "k1", deepseek: "k2" });
  });

  it("getAllApiKeys returns an empty object when nothing is stored", async () => {
    expect(await apiKeyStorage.getAllApiKeys()).toEqual({});
  });
});

describe("apiKeyStorage.getProviderFromModel", () => {
  it("extracts a known cloud provider prefix", () => {
    expect(apiKeyStorage.getProviderFromModel("google:gemini-pro")).toBe("google");
    expect(apiKeyStorage.getProviderFromModel("OpenAI:gpt-4")).toBe("openai");
  });

  it("returns null for an unrecognized prefix", () => {
    expect(apiKeyStorage.getProviderFromModel("vllm:qwen")).toBeNull();
    expect(apiKeyStorage.getProviderFromModel("unknown-model")).toBeNull();
  });
});

describe("apiKeyStorage.requiresApiKey", () => {
  it("is false for ollama/vllm-prefixed models", () => {
    expect(apiKeyStorage.requiresApiKey("ollama:llama3")).toBe(false);
    expect(apiKeyStorage.requiresApiKey("vllm:qwen2.5")).toBe(false);
  });

  it("is true for cloud-prefixed models", () => {
    expect(apiKeyStorage.requiresApiKey("openai:gpt-4")).toBe(true);
  });
});

describe("apiKeyStorage.buildApiKeysForModel", () => {
  it("builds an enabled payload for ollama without a stored key", async () => {
    expect(await apiKeyStorage.buildApiKeysForModel("ollama:llama3")).toEqual({
      ollama: { isEnabled: true },
    });
  });

  it("builds an enabled payload for vllm without a stored key", async () => {
    expect(await apiKeyStorage.buildApiKeysForModel("vllm:qwen2.5-32b-instruct")).toEqual({
      vllm: { isEnabled: true },
    });
  });

  it("returns an empty object for an unrecognized provider prefix", async () => {
    expect(await apiKeyStorage.buildApiKeysForModel("mystery:model")).toEqual({});
  });

  it("returns an empty object when the cloud provider has no stored key", async () => {
    expect(await apiKeyStorage.buildApiKeysForModel("openai:gpt-4")).toEqual({});
  });

  it("builds the apiKey payload for a cloud provider with a stored key", async () => {
    await apiKeyStorage.setApiKey("anthropic", "sk-ant-1");
    expect(await apiKeyStorage.buildApiKeysForModel("anthropic:claude-sonnet")).toEqual({
      anthropic: { apiKey: "sk-ant-1", isEnabled: true },
    });
  });
});
