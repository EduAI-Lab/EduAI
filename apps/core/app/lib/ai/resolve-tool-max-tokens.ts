/** Env upper bound for tool-path completion tokens (1024–128_000). */
export function toolMaxOutputTokensEnvCap(): number {
  return Math.min(
    128_000,
    Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 8192),
  );
}

/**
 * Cap tool-path `maxTokens` against admin-configured model limits.
 * Prevents requests like max_tokens=32000 against vLLM models with 16K context.
 */
export function resolveToolMaxOutputTokens(modelMaxTokens?: number | null): number {
  const envCap = toolMaxOutputTokensEnvCap();
  if (modelMaxTokens != null && modelMaxTokens > 0) {
    return Math.min(envCap, modelMaxTokens);
  }
  return envCap;
}
