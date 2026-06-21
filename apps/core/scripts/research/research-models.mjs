/**
 * Fixed-model overrides for issue #501 stress tests.
 *
 * When RESEARCH_FIXED_MODEL (or RESEARCH_CLASSROOM_MODEL) is set, research
 * runners pin the chat model instead of using routing policies (P0/P1/P3b).
 */

export const ISSUE_501_MODELS = {
  "7B": {
    label: "7B",
    model: "vllm:qwen2.5-7b-instruct",
    timeoutMs: 180_000,
  },
  "32B": {
    label: "32B",
    model: "vllm:qwen2.5-32b-instruct",
    timeoutMs: 300_000,
  },
  "120B": {
    label: "120B",
    model: "ollama:gpt-oss:120b",
    timeoutMs: 300_000,
  },
  GEMINI: {
    label: "GEMINI",
    model: "google:gemini-2.5-flash",
    timeoutMs: 120_000,
  },
  OPENROUTER: {
    label: "OPENROUTER",
    model: "openai:google/gemini-2.5-flash",
    timeoutMs: 120_000,
  },
};

/** @param {(primary: string, alias?: string) => string | undefined} readEnv */
export function resolveFixedModel(readEnv) {
  const raw =
    readEnv("RESEARCH_FIXED_MODEL") ??
    readEnv("RESEARCH_CLASSROOM_MODEL") ??
    readEnv("RESEARCH_RUN_MODEL");
  if (!raw) return null;

  const key = raw.trim().toUpperCase();
  const alias = ISSUE_501_MODELS[key];
  if (alias) {
    return {
      policy: `fixed-${alias.label}`,
      requested_model: alias.model,
      description: `fixed-${alias.label.toLowerCase()}`,
      timeoutMs: alias.timeoutMs,
    };
  }

  return {
    policy: "fixed",
    requested_model: raw.trim(),
    description: "fixed-custom",
    timeoutMs: Math.max(
      30_000,
      Number(readEnv("RESEARCH_RUN_TIMEOUT_MS", "180000")) || 180_000,
    ),
  };
}
