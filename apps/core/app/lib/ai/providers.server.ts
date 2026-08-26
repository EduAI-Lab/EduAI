import prisma from "../prisma.server";
import { parseModelIdentifier, type SupportedProvider } from "./providers";

export type ActiveChatModel = {
  name: string;
  supportsTools: boolean;
  supportsImages: boolean;
  /** DB maxTokens — often total context window for vLLM, not output-only. */
  maxTokens: number | null;
  /** Per-model override for the context fill ratio; null/absent = env/global default. */
  contextFillRatio?: number | null;
};

/** Rough chars-per-token for budgeting when the provider has no tokenizer hook. */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

/**
 * Resolve the active AIModel row for a provider:modelId chat identifier.
 */
export async function resolveActiveChatModel(
  modelIdentifier: string,
): Promise<ActiveChatModel | null> {
  const parsed = parseModelIdentifier(modelIdentifier);
  if (!parsed) {
    return null;
  }

  const model = await prisma.aIModel.findFirst({
    where: {
      modelId: parsed.modelId,
      // Completion and chat must only resolve models exposed by the active
      // chat catalog; inactive providers/models and non-chat rows are not
      // valid provider policy for this endpoint.
      provider: { name: parsed.providerId, isActive: true },
      type: "CHAT",
      isActive: true,
    },
    select: {
      supportsTools: true,
      supportsImages: true,
      maxTokens: true,
      contextFillRatio: true,
      name: true,
    },
  });

  if (!model) {
    return null;
  }

  return {
    name: model.name,
    supportsTools: model.supportsTools,
    supportsImages: model.supportsImages,
    maxTokens: model.maxTokens,
    contextFillRatio: model.contextFillRatio,
  };
}

/** Total context window (input + output) for budgeting. */
export function resolveModelContextWindow(
  dbMaxTokens: number | null | undefined,
  providerId?: SupportedProvider,
): number {
  if (providerId === "vllm") {
    // Admin rows sometimes store 8192; cmps01 qwen2.5-32b is 16384 total.
    if (!dbMaxTokens || dbMaxTokens <= 8192) {
      return 16384;
    }
    return dbMaxTokens;
  }

  if (dbMaxTokens && dbMaxTokens > 0) {
    return dbMaxTokens;
  }

  return 128_000;
}

export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / ESTIMATED_CHARS_PER_TOKEN));
}

/**
 * Desired completion cap before prompt-size adjustment.
 * DB maxTokens is often the model context window, not a safe output limit.
 */
export function resolveMaxOutputTokens(
  dbMaxTokens: number | null | undefined,
  providerId?: SupportedProvider,
): number {
  const envCeiling = Math.min(
    128_000,
    Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 8192),
  );
  const defaultOutput = providerId === "vllm" ? 2048 : 4096;

  if (dbMaxTokens && dbMaxTokens > 0 && dbMaxTokens < 8192) {
    return Math.min(dbMaxTokens, defaultOutput, envCeiling);
  }

  return Math.min(defaultOutput, envCeiling);
}

/**
 * Rough token cost of OpenAI-style tool/function definitions on the wire.
 * Admin tools with rich Zod schemas often land ~350–500 tokens each; the
 * fixed envelope covers shared request framing.
 */
export function estimateToolDefinitionTokens(toolCount: number): number {
  if (!Number.isFinite(toolCount) || toolCount <= 0) {
    return 0;
  }
  return 256 + Math.floor(toolCount) * 420;
}

/**
 * Reserve headroom for mid-turn tool results on multi-step admin calls
 * (e.g. deleteUser then listUsers). Pre-flight estimates only see the user
 * message — not the JSON payloads injected on later streamText steps.
 */
export function estimateAdminToolStepReserve(contextWindow: number): number {
  if (contextWindow <= 16_384) {
    return 3_500;
  }
  if (contextWindow <= 32_768) {
    return 2_000;
  }
  return 0;
}

/** Default fraction of the context window the prompt may fill before digesting older turns. */
export const DEFAULT_CONTEXT_FILL_RATIO = 0.9;
const CONTEXT_FILL_RATIO_MIN = 0.5;
const CONTEXT_FILL_RATIO_MAX = 0.98;

/**
 * Fraction of the model context window the assembled prompt (history + system +
 * RAG + tool schemas + reserved output) may fill before older turns are
 * digested. Per-model DB override wins, then env `CHAT_CONTEXT_FILL_RATIO`, then
 * {@link DEFAULT_CONTEXT_FILL_RATIO}. Clamped so a bad value can neither disable
 * digesting nor starve the prompt.
 */
export function resolveContextFillRatio(perModelRatio?: number | null): number {
  for (const value of [perModelRatio, Number(process.env.CHAT_CONTEXT_FILL_RATIO)]) {
    if (value != null && Number.isFinite(value) && value > 0) {
      return Math.min(CONTEXT_FILL_RATIO_MAX, Math.max(CONTEXT_FILL_RATIO_MIN, value));
    }
  }
  return DEFAULT_CONTEXT_FILL_RATIO;
}

/**
 * History char budget for `prepareBoundedSessionContext`, derived from the model
 * context window so digesting triggers on tokens — not message count (#1639).
 *
 * The fill ratio bounds the **input** prompt: history + system + RAG + tool
 * schemas + mid-turn tool-step payloads must fit within `ratio × contextWindow`,
 * leaving the remaining `(1 - ratio)` of the window for the completion (the
 * caller caps output into that space separately via {@link capMaxOutputTokensForPrompt}).
 * Everything else sharing the input allowance is reserved first; the remainder
 * is what history may occupy. It is never inflated past what the window leaves:
 * once the reservations already fill the input budget, history yields to zero so
 * the caller's fit-check can fail closed instead of forcing an over-context
 * request (#1643). Returned in characters for the char-budgeted digest path.
 */
export function resolveSessionCharBudgetForModel(params: {
  contextWindow: number;
  perModelRatio?: number | null;
  systemChars?: number;
  ragChars?: number;
  toolCount?: number;
  /** Reserve headroom for mid-turn tool-result payloads on multi-step tool calls. */
  reserveToolSteps?: boolean;
  safetyBufferTokens?: number;
}): number {
  const ratio = resolveContextFillRatio(params.perModelRatio);
  const inputTokenBudget = Math.floor(params.contextWindow * ratio);

  const reserved =
    estimateToolDefinitionTokens(params.toolCount ?? 0) +
    (params.reserveToolSteps ? estimateAdminToolStepReserve(params.contextWindow) : 0) +
    estimateTokensFromChars(params.systemChars ?? 0) +
    estimateTokensFromChars(params.ragChars ?? 0) +
    (params.safetyBufferTokens ?? 256);

  // History gets whatever the input budget leaves after the fixed reservations,
  // and never more: a large fixed prompt (big system/RAG block + tool schemas)
  // must be able to squeeze history to zero so the caller's fit-check can fail
  // closed instead of forcing an over-context request (#1643).
  const historyTokens = Math.max(0, inputTokenBudget - reserved);
  return historyTokens * ESTIMATED_CHARS_PER_TOKEN;
}

/** Fit completion tokens inside what remains after the prompt (+ safety buffer). */
export function capMaxOutputTokensForPrompt(params: {
  contextWindow: number;
  estimatedInputTokens: number;
  desiredMaxOutput: number;
  minOutput?: number;
  safetyBuffer?: number;
  /**
   * Tokens reserved for tool JSON schemas. Prefer {@link estimateToolDefinitionTokens}
   * when tools are present — the old flat 512 under-counts admin registries and
   * caused ContextWindowExceededError on 16k models.
   */
  toolDefinitionTokens?: number;
  toolCount?: number;
}): number {
  const minOutput = params.minOutput ?? 256;
  const safetyBuffer = params.safetyBuffer ?? 384;
  const toolDefinitionAllowance =
    params.toolDefinitionTokens ??
    (params.toolCount != null ? estimateToolDefinitionTokens(params.toolCount) : 512);
  const headroom =
    params.contextWindow - params.estimatedInputTokens - safetyBuffer - toolDefinitionAllowance;

  if (headroom <= minOutput) {
    return minOutput;
  }

  return Math.min(params.desiredMaxOutput, headroom);
}

/** True when input + completion (+ buffer) fit the model context window. */
export function promptFitsContextWindow(params: {
  contextWindow: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  safetyBuffer?: number;
}): boolean {
  const safetyBuffer = params.safetyBuffer ?? 256;
  return (
    params.estimatedInputTokens + params.maxOutputTokens + safetyBuffer <= params.contextWindow
  );
}

export type ChatModelCapabilities = {
  supportsTools: boolean;
  supportsImages: boolean;
  maxTokens: number | null;
  /** Per-model context fill ratio override; null/absent = env/global default. */
  contextFillRatio?: number | null;
  name: string | null;
};

/**
 * Load tool support and output limits for a chat model (server-only — uses Prisma).
 */
export async function getChatModelCapabilities(
  modelIdentifier: string,
): Promise<ChatModelCapabilities> {
  try {
    const model = await resolveActiveChatModel(modelIdentifier);
    const capabilities: ChatModelCapabilities = {
      supportsTools: model?.supportsTools ?? false,
      supportsImages: model?.supportsImages ?? false,
      maxTokens: model?.maxTokens ?? null,
      contextFillRatio: model?.contextFillRatio ?? null,
      name: model?.name ?? null,
    };
    console.log(
      `Model ${modelIdentifier} (${capabilities.name || "unknown"}) supports tools: ${capabilities.supportsTools}`,
    );
    return capabilities;
  } catch (error) {
    console.error("Error checking model tool support:", error);
    return {
      supportsTools: false,
      supportsImages: false,
      maxTokens: null,
      contextFillRatio: null,
      name: null,
    };
  }
}

/**
 * Check if a model supports tool calling (server-only — uses Prisma).
 */
export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  const capabilities = await getChatModelCapabilities(modelIdentifier);
  return capabilities.supportsTools;
}
