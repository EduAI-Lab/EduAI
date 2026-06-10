import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_OPENAI_MODEL,
  isAllowedEmbeddingModel,
  isEmbeddingIndexStale,
  parseEmbeddingSettingsUpdate,
  resolveEffectiveEmbeddingSettings,
  resolveEnvEmbeddingProvider,
  validateEmbeddingSettingsUpdate,
} from "~/lib/ai/embedding-config";

describe("resolveEffectiveEmbeddingSettings", () => {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalModel = process.env.OLLAMA_EMBEDDING_MODEL;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = originalProvider;
    if (originalModel === undefined) delete process.env.OLLAMA_EMBEDDING_MODEL;
    else process.env.OLLAMA_EMBEDDING_MODEL = originalModel;
  });

  it("uses server env when course overrides are null", () => {
    process.env.EMBEDDING_PROVIDER = "local";
    process.env.OLLAMA_EMBEDDING_MODEL = "mxbai-embed-large";

    const effective = resolveEffectiveEmbeddingSettings({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });

    expect(effective.provider).toBe("local");
    expect(effective.model).toBe(DEFAULT_OLLAMA_EMBEDDING_MODEL);
    expect(effective.wantsLocal).toBe(true);
    expect(effective.source.provider).toBe("env");
  });

  it("prefers course provider and model over env", () => {
    process.env.EMBEDDING_PROVIDER = "local";

    const effective = resolveEffectiveEmbeddingSettings({
      embeddingProvider: "cloud",
      embeddingModel: DEFAULT_OPENROUTER_OPENAI_MODEL,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });

    expect(effective.provider).toBe("cloud");
    expect(effective.model).toBe(DEFAULT_OPENROUTER_OPENAI_MODEL);
    expect(effective.wantsLocal).toBe(false);
    expect(effective.source.provider).toBe("course");
    expect(effective.source.model).toBe("course");
  });
});

describe("isEmbeddingIndexStale", () => {
  it("returns false when nothing was indexed yet", () => {
    const effective = resolveEffectiveEmbeddingSettings({
      embeddingProvider: "local",
      embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });

    expect(
      isEmbeddingIndexStale(
        {
          embeddingProvider: "local",
          embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
          embeddedWithProvider: null,
          embeddedWithModel: null,
          lastEmbeddedAt: null,
        },
        effective,
      ),
    ).toBe(false);
  });

  it("returns true when indexed model differs from effective settings", () => {
    const course = {
      embeddingProvider: "local",
      embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
      embeddedWithProvider: "cloud",
      embeddedWithModel: DEFAULT_OPENROUTER_OPENAI_MODEL,
      lastEmbeddedAt: new Date(),
    };
    const effective = resolveEffectiveEmbeddingSettings(course);
    expect(isEmbeddingIndexStale(course, effective)).toBe(true);
  });
});

describe("parseEmbeddingSettingsUpdate", () => {
  it("accepts partial provider updates", () => {
    const parsed = parseEmbeddingSettingsUpdate({ embeddingProvider: "cloud" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ embeddingProvider: "cloud" });
    }
  });

  it("rejects unknown providers", () => {
    const parsed = parseEmbeddingSettingsUpdate({ embeddingProvider: "gemini" });
    expect(parsed.ok).toBe(false);
  });
});

describe("validateEmbeddingSettingsUpdate", () => {
  const base = {
    embeddingProvider: null,
    embeddingModel: null,
    embeddedWithProvider: null,
    embeddedWithModel: null,
    lastEmbeddedAt: null,
  };

  it("rejects disallowed models for the provider", () => {
    const result = validateEmbeddingSettingsUpdate(base, {
      embeddingProvider: "local",
      embeddingModel: "bad-model",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts allowed local models", () => {
    const result = validateEmbeddingSettingsUpdate(base, {
      embeddingProvider: "local",
      embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isAllowedEmbeddingModel("local", result.value.embeddingModel!)).toBe(true);
    }
  });
});

describe("resolveEnvEmbeddingProvider", () => {
  const original = process.env.EMBEDDING_PROVIDER;

  afterEach(() => {
    if (original === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = original;
  });

  it("maps ollama alias to local", () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    expect(resolveEnvEmbeddingProvider()).toBe("local");
  });
});
