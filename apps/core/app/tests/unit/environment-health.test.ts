import { describe, expect, it } from "vitest";
import { getEnvironmentHealth } from "~/lib/environment-health.server";

describe("getEnvironmentHealth", () => {
  it("reports required keys and the local embedding endpoint by name only", () => {
    expect(getEnvironmentHealth({ EMBEDDING_PROVIDER: "local" })).toEqual({
      missingKeys: [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "EDUAI_API_KEY",
        "OLLAMA_BASE_URL",
      ],
    });
  });

  it("accepts any supported cloud embedding key", () => {
    const result = getEnvironmentHealth({
      DATABASE_URL: "configured",
      BETTER_AUTH_SECRET: "configured",
      EDUAI_API_KEY: "configured",
      EMBEDDING_PROVIDER: "cloud",
      GOOGLE_GENERATIVE_AI_API_KEY: "configured",
    });

    expect(result.missingKeys).toEqual([]);
  });
});
