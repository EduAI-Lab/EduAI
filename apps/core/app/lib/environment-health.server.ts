export type EnvironmentHealth = {
  missingKeys: string[];
};

function isMissing(value: string | undefined): boolean {
  return !value?.trim();
}

/**
 * Return names only—never values—so admins can diagnose configuration without
 * turning the health warning itself into a secret-disclosure endpoint.
 */
export function getEnvironmentHealth(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentHealth {
  const missingKeys = ["DATABASE_URL", "BETTER_AUTH_SECRET", "EDUAI_API_KEY"].filter(
    (key) => isMissing(env[key]),
  );

  const embeddingProvider = env.EMBEDDING_PROVIDER?.trim().toLowerCase() || "cloud";
  if (embeddingProvider === "local") {
    if (isMissing(env.OLLAMA_BASE_URL)) missingKeys.push("OLLAMA_BASE_URL");
  } else if (
    ["OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY"].every(
      (key) => isMissing(env[key]),
    )
  ) {
    missingKeys.push(
      "OPENROUTER_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY",
    );
  }

  return { missingKeys };
}
