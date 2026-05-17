import { describe, it, expect } from "vitest";
import {
  CreateAIProviderSchema,
  UpdateAIProviderSchema,
  CreateAIModelSchema,
  UpdateAIModelSchema,
} from "~/lib/ai/schemas";

describe("CreateAIProviderSchema", () => {
  it("accepts valid input and applies defaults", () => {
    const r = CreateAIProviderSchema.safeParse({
      name: "openai",
      displayName: "OpenAI",
      description: "Foundation models",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.requiresApiKey).toBe(true);
      expect(r.data.isActive).toBe(true);
    }
  });

  it("rejects an invalid defaultBaseUrl", () => {
    expect(
      CreateAIProviderSchema.safeParse({
        name: "x",
        displayName: "X",
        description: "x",
        defaultBaseUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("requires non-empty name, displayName, and description", () => {
    expect(
      CreateAIProviderSchema.safeParse({
        name: "",
        displayName: "",
        description: "",
      }).success,
    ).toBe(false);
  });
});

describe("UpdateAIProviderSchema", () => {
  it("accepts an empty patch", () => {
    expect(UpdateAIProviderSchema.safeParse({}).success).toBe(true);
  });

  it("validates defaultBaseUrl when provided", () => {
    expect(UpdateAIProviderSchema.safeParse({ defaultBaseUrl: "bad" }).success).toBe(false);
    expect(
      UpdateAIProviderSchema.safeParse({ defaultBaseUrl: "https://api.openai.com" }).success,
    ).toBe(true);
  });
});

describe("CreateAIModelSchema", () => {
  const base = {
    modelId: "gpt-4o",
    name: "GPT-4o",
    description: "OpenAI model",
    type: "CHAT" as const,
    providerId: "p1",
  };

  it("accepts valid input and applies defaults", () => {
    const r = CreateAIModelSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.supportsImages).toBe(false);
      expect(r.data.supportsTools).toBe(false);
      expect(r.data.supportsStreaming).toBe(true);
      expect(r.data.isActive).toBe(true);
    }
  });

  it("accepts every valid model type", () => {
    for (const type of [
      "CHAT",
      "COMPLETION",
      "EMBEDDING",
      "IMAGE",
      "AUDIO",
      "VIDEO",
    ] as const) {
      expect(CreateAIModelSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it("rejects an invalid type", () => {
    expect(CreateAIModelSchema.safeParse({ ...base, type: "BAD" }).success).toBe(false);
  });

  it("rejects negative pricing", () => {
    expect(CreateAIModelSchema.safeParse({ ...base, inputPricing: -1 }).success).toBe(false);
    expect(CreateAIModelSchema.safeParse({ ...base, outputPricing: -1 }).success).toBe(false);
  });

  it("rejects a non-integer maxTokens", () => {
    expect(CreateAIModelSchema.safeParse({ ...base, maxTokens: 1.5 }).success).toBe(false);
  });

  it("rejects a zero/negative maxTokens", () => {
    expect(CreateAIModelSchema.safeParse({ ...base, maxTokens: 0 }).success).toBe(false);
  });

  it("requires a non-empty providerId", () => {
    expect(CreateAIModelSchema.safeParse({ ...base, providerId: "" }).success).toBe(false);
  });
});

describe("UpdateAIModelSchema", () => {
  it("accepts an empty patch", () => {
    expect(UpdateAIModelSchema.safeParse({}).success).toBe(true);
  });

  it("rejects negative pricing when provided", () => {
    expect(UpdateAIModelSchema.safeParse({ inputPricing: -0.001 }).success).toBe(false);
  });

  it("rejects an empty providerId when provided", () => {
    expect(UpdateAIModelSchema.safeParse({ providerId: "" }).success).toBe(false);
  });
});
