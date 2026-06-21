/** Shared hybrid/tool flags for research chat POST bodies. */

export function isWebToolPrompt(row) {
  return row.tools_expected === "webSearch" || row.tools_expected === "fetchPage";
}

/**
 * Research runs bypass vLLM multi-step tool calling (hangs on 32B).
 * Web/fetch prompts use server-side hybrid prefetch instead.
 */
export function resolveResearchChatFlags(row, { forceHybridAll = false } = {}) {
  const useHybridWebTools = isWebToolPrompt(row);
  return {
    forceHybridRag: forceHybridAll || true,
    hybridWebTools: useHybridWebTools,
    tool_execution_mode: useHybridWebTools ? "hybrid_prefetch" : "hybrid_rag",
  };
}

export function resolveResearchTimeoutMs(readEnv, row) {
  const base = Math.max(
    30_000,
    Number(readEnv("RESEARCH_RUN_TIMEOUT_MS", "180000")) || 180_000,
  );
  if (!isWebToolPrompt(row)) return base;
  const toolMs = Number(readEnv("RESEARCH_TOOL_TIMEOUT_MS", "240000")) || 240_000;
  return Math.max(base, toolMs);
}
