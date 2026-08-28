import { describe, it, expect } from "vitest";
import {
  CreateAIProviderSchema,
  UpdateAIProviderSchema,
  CreateAIModelSchema,
  UpdateAIModelSchema,
} from "~/lib/ai/schemas";

// ---------------------------------------------------------------------------
// CreateAIProviderSchema
// ---------------------------------------------------------------------------

describe("CreateAIProviderSchema", () => {
  const valid = {
    name: "openai",
    displayName: "OpenAI",
    description: "OpenAI provider",
    defaultBaseUrl: "https://api.openai.com",
    envVarName: "OPENAI_API_KEY",
  };

  it("passes for a fully valid object", () => {
    expect(CreateAIProviderSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when name is an empty string", () => {
    const result = CreateAIProviderSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("fails when displayName is an empty string", () => {
    const result = CreateAIProviderSchema.safeParse({ ...valid, displayName: "" });
    expect(result.success).toBe(false);
  });

  it("fails when description is an empty string", () => {
    const result = CreateAIProviderSchema.safeParse({ ...valid, description: "" });
    expect(result.success).toBe(false);
  });

  it("fails when defaultBaseUrl is present but not a valid URL", () => {
    const result = CreateAIProviderSchema.safeParse({
      ...valid,
      defaultBaseUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("defaults requiresApiKey to true when omitted", () => {
    const result = CreateAIProviderSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiresApiKey).toBe(true);
    }
  });

  it("defaults isActive to true when omitted", () => {
    const result = CreateAIProviderSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateAIProviderSchema
// ---------------------------------------------------------------------------

describe("UpdateAIProviderSchema", () => {
  it("passes for an empty object (all fields optional)", () => {
    expect(UpdateAIProviderSchema.safeParse({}).success).toBe(true);
  });

  it("fails when defaultBaseUrl is present but not a valid URL", () => {
    const result = UpdateAIProviderSchema.safeParse({ defaultBaseUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateAIModelSchema
// ---------------------------------------------------------------------------

describe("CreateAIModelSchema", () => {
  const valid = {
    modelId: "gpt-4o",
    name: "GPT-4o",
    description: "Latest GPT model",
    type: "CHAT",
    providerId: "openai",
  };

  it("passes for a fully valid object", () => {
    expect(CreateAIModelSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when type is not one of the allowed enum values", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, type: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("fails when inputPricing is negative", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, inputPricing: -1 });
    expect(result.success).toBe(false);
  });

  it("fails when outputPricing is negative", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, outputPricing: -0.01 });
    expect(result.success).toBe(false);
  });

  it("fails when providerId is an empty string", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, providerId: "" });
    expect(result.success).toBe(false);
  });

  it("defaults supportsImages to false when omitted", () => {
    const result = CreateAIModelSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportsImages).toBe(false);
    }
  });

  it("defaults supportsTools to false when omitted", () => {
    const result = CreateAIModelSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportsTools).toBe(false);
    }
  });

  it("defaults supportsStreaming to true when omitted", () => {
    const result = CreateAIModelSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportsStreaming).toBe(true);
    }
  });

  it("defaults isActive to true when omitted", () => {
    const result = CreateAIModelSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("accepts a contextFillRatio inside the 0.5–0.98 clamp (#1639)", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, contextFillRatio: 0.85 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contextFillRatio).toBe(0.85);
    }
  });

  it("rejects a contextFillRatio below 0.5 or above 0.98 (#1639)", () => {
    expect(CreateAIModelSchema.safeParse({ ...valid, contextFillRatio: 0.3 }).success).toBe(false);
    expect(CreateAIModelSchema.safeParse({ ...valid, contextFillRatio: 1.2 }).success).toBe(false);
  });

  it("accepts null contextFillRatio to clear the per-model override (#1639)", () => {
    const result = CreateAIModelSchema.safeParse({ ...valid, contextFillRatio: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contextFillRatio).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateAIModelSchema
// ---------------------------------------------------------------------------

describe("UpdateAIModelSchema", () => {
  it("passes for an empty object (all fields optional)", () => {
    expect(UpdateAIModelSchema.safeParse({}).success).toBe(true);
  });

  it("fails when a provided field fails its own constraint", () => {
    const result = UpdateAIModelSchema.safeParse({ type: "INVALID_TYPE" });
    expect(result.success).toBe(false);
  });

  it("accepts and clamps contextFillRatio; null clears it (#1639)", () => {
    expect(UpdateAIModelSchema.safeParse({ contextFillRatio: 0.9 }).success).toBe(true);
    expect(UpdateAIModelSchema.safeParse({ contextFillRatio: null }).success).toBe(true);
    expect(UpdateAIModelSchema.safeParse({ contextFillRatio: 0.1 }).success).toBe(false);
  });
});
