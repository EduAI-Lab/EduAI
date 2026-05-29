import { describe, it, expect } from "vitest";
import {
  clientApiKeysBodySchema,
  toUserProviderSettings,
} from "~/lib/chat-api-keys.schema";

describe("clientApiKeysBodySchema", () => {
  it("accepts a record of provider settings", () => {
    const result = clientApiKeysBodySchema.safeParse({
      openai: { isEnabled: true, apiKey: "sk-test" },
      ollama: { isEnabled: false, baseUrl: "http://localhost:11434" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-object apiKeys values", () => {
    expect(clientApiKeysBodySchema.safeParse("bad").success).toBe(false);
    expect(clientApiKeysBodySchema.safeParse([]).success).toBe(false);
  });

  it("rejects provider entries with invalid field types", () => {
    const result = clientApiKeysBodySchema.safeParse({
      openai: { isEnabled: "yes" },
    });
    expect(result.success).toBe(false);
  });
});

describe("toUserProviderSettings", () => {
  it("defaults isEnabled to false when omitted", () => {
    const settings = toUserProviderSettings({
      google: { apiKey: "key" },
    });
    expect(settings.google).toEqual({
      isEnabled: false,
      apiKey: "key",
      baseUrl: undefined,
    });
  });

  it("preserves explicit isEnabled, apiKey, and baseUrl", () => {
    const settings = toUserProviderSettings({
      ollama: {
        isEnabled: true,
        baseUrl: "http://127.0.0.1:11434",
      },
    });
    expect(settings.ollama).toEqual({
      isEnabled: true,
      apiKey: undefined,
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("maps multiple providers", () => {
    const settings = toUserProviderSettings({
      openai: { isEnabled: true, apiKey: "a" },
      google: { isEnabled: false },
    });
    expect(Object.keys(settings)).toEqual(["openai", "google"]);
  });

  it("returns empty object for empty input", () => {
    expect(toUserProviderSettings({})).toEqual({});
  });
});
