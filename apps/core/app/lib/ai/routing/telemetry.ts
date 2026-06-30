/**
 * Token usage normalization helpers (client-safe — no server imports).
 */

export type NormalizedTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

function asTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/** vLLM/LiteLLM may return zeros when stream usage was not requested. */
function isMissingUsage(
  promptTokens: number | null,
  completionTokens: number | null,
  totalTokens: number | null,
): boolean {
  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return true;
  }
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  const total = totalTokens ?? prompt + completion;
  return prompt === 0 && completion === 0 && total === 0;
}

/** AI SDK / OpenAI-compatible providers may use promptTokens or inputTokens. */
export function normalizeTokenUsage(
  usage: Record<string, unknown> | undefined | null,
): NormalizedTokenUsage {
  if (!usage) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const promptTokens =
    asTokenCount(usage.promptTokens) ??
    asTokenCount(usage.inputTokens) ??
    asTokenCount(usage.prompt_tokens);
  const completionTokens =
    asTokenCount(usage.completionTokens) ??
    asTokenCount(usage.outputTokens) ??
    asTokenCount(usage.completion_tokens);
  const totalTokens =
    asTokenCount(usage.totalTokens) ??
    asTokenCount(usage.total_tokens) ??
    (promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null);
  if (isMissingUsage(promptTokens, completionTokens, totalTokens)) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  return { promptTokens, completionTokens, totalTokens };
}

/** Pick the first source that yields token counts (finish hook, AI SDK usage, raw body). */
export function coalesceTokenUsage(
  ...sources: (Record<string, unknown> | undefined | null)[]
): NormalizedTokenUsage {
  for (const source of sources) {
    const normalized = normalizeTokenUsage(source);
    if (
      normalized.promptTokens != null ||
      normalized.completionTokens != null ||
      normalized.totalTokens != null
    ) {
      return normalized;
    }
  }
  return { promptTokens: null, completionTokens: null, totalTokens: null };
}

export function splitRegistryModelId(
  identifier: string,
): { providerName: string; modelId: string } | null {
  const firstColon = identifier.indexOf(":");
  if (firstColon === -1) return null;
  const providerName = identifier.slice(0, firstColon);
  const modelId = identifier.slice(firstColon + 1);
  if (!providerName || !modelId) return null;
  return { providerName, modelId };
}
