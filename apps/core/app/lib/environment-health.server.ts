import { resolveEnvEmbeddingProvider } from "~/lib/ai/embedding-config";
import { getExpectedEmbeddingDimension } from "~/lib/ai/embedding";

export type EnvironmentHealth = {
  missingKeys: string[];
};

function isMissing(value: string | undefined): boolean {
  return !value?.trim();
}

/**
 * Return names only—never values—so admins can diagnose configuration without
 * turning the health warning itself into a secret-disclosure endpoint.
 *
 * Provider/dimension checks mirror the runtime resolvers in embedding-config.ts
 * and embedding.ts (local means EMBEDDING_PROVIDER is "local" or "ollama"; Google
 * only satisfies the cloud path when EMBEDDING_DIMENSION is 3072) so this warning
 * can't diverge from what actually gets used to embed.
 */
export function getEnvironmentHealth(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentHealth {
  const missingKeys = ["DATABASE_URL", "BETTER_AUTH_SECRET", "EDUAI_API_KEY"].filter(
    (key) => isMissing(env[key]),
  );

  const embeddingProvider = resolveEnvEmbeddingProvider();
  if (embeddingProvider === "local") {
    if (isMissing(env.OLLAMA_BASE_URL)) missingKeys.push("OLLAMA_BASE_URL");
  } else if (getExpectedEmbeddingDimension() === 3072) {
    if (
      ["OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY"].every(
        (key) => isMissing(env[key]),
      )
    ) {
      missingKeys.push(
        "OPENROUTER_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY",
      );
    }
  } else if (["OPENROUTER_API_KEY", "OPENAI_API_KEY"].every((key) => isMissing(env[key]))) {
    missingKeys.push("OPENROUTER_API_KEY or OPENAI_API_KEY");
  }

  return { missingKeys };
}
