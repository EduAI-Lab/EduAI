import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnvironmentHealth } from "~/lib/environment-health.server";

const EMBEDDING_ENV_KEYS = [
  "EMBEDDING_PROVIDER",
  "EMBEDDING_DIMENSION",
  "OLLAMA_BASE_URL",
  "OPENROUTER_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("getEnvironmentHealth", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(EMBEDDING_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of EMBEDDING_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports required keys and the local embedding endpoint by name only", () => {
    process.env.EMBEDDING_PROVIDER = "local";
    expect(getEnvironmentHealth({ EMBEDDING_PROVIDER: "local" })).toEqual({
      missingKeys: [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "EDUAI_API_KEY",
        "OLLAMA_BASE_URL",
      ],
    });
  });

  it("treats the ollama alias the same as local, matching the runtime resolver", () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    const result = getEnvironmentHealth({
      DATABASE_URL: "configured",
      BETTER_AUTH_SECRET: "configured",
      EDUAI_API_KEY: "configured",
      EMBEDDING_PROVIDER: "ollama",
    });

    expect(result.missingKeys).toEqual(["OLLAMA_BASE_URL"]);
  });

  it("accepts OpenRouter or OpenAI for the default 1024-dim cloud path", () => {
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.OPENAI_API_KEY = "configured";
    const result = getEnvironmentHealth({
      DATABASE_URL: "configured",
      BETTER_AUTH_SECRET: "configured",
      EDUAI_API_KEY: "configured",
      OPENAI_API_KEY: "configured",
    });

    expect(result.missingKeys).toEqual([]);
  });

  it("does not accept Google alone for the default 1024-dim cloud path", () => {
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "configured";
    const result = getEnvironmentHealth({
      DATABASE_URL: "configured",
      BETTER_AUTH_SECRET: "configured",
      EDUAI_API_KEY: "configured",
      GOOGLE_GENERATIVE_AI_API_KEY: "configured",
    });

    expect(result.missingKeys).toEqual(["OPENROUTER_API_KEY or OPENAI_API_KEY"]);
  });

  it("accepts any supported cloud embedding key on the legacy 3072-dim path", () => {
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.EMBEDDING_DIMENSION = "3072";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "configured";
    const result = getEnvironmentHealth({
      DATABASE_URL: "configured",
      BETTER_AUTH_SECRET: "configured",
      EDUAI_API_KEY: "configured",
      GOOGLE_GENERATIVE_AI_API_KEY: "configured",
    });

    expect(result.missingKeys).toEqual([]);
  });
});
