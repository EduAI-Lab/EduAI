import prisma from '../prisma.server';
import { parseModelIdentifier, type SupportedProvider } from './providers';

export type ActiveChatModel = {
  name: string;
  supportsTools: boolean;
  /** DB maxTokens — often total context window for vLLM, not output-only. */
  maxTokens: number | null;
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
      provider: { name: parsed.providerId },
      isActive: true,
    },
    select: {
      supportsTools: true,
      maxTokens: true,
      name: true,
    },
  });

  if (!model) {
    return null;
  }

  return {
    name: model.name,
    supportsTools: model.supportsTools,
    maxTokens: model.maxTokens,
  };
}

/** Total context window (input + output) for budgeting. */
export function resolveModelContextWindow(
  dbMaxTokens: number | null | undefined,
  providerId?: SupportedProvider,
): number {
  if (providerId === 'vllm') {
    // Admin rows can be stale; the fleet Qwen3.5 profile is capped at 16384 total.
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
  const defaultOutput = providerId === 'vllm' ? 2048 : 4096;

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
    (params.toolCount != null
      ? estimateToolDefinitionTokens(params.toolCount)
      : 512);
  const headroom =
    params.contextWindow -
    params.estimatedInputTokens -
    safetyBuffer -
    toolDefinitionAllowance;

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
    params.estimatedInputTokens + params.maxOutputTokens + safetyBuffer <=
    params.contextWindow
  );
}

export type ChatModelCapabilities = {
  supportsTools: boolean;
  maxTokens: number | null;
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
      maxTokens: model?.maxTokens ?? null,
      name: model?.name ?? null,
    };
    console.log(
      `Model ${modelIdentifier} (${capabilities.name || 'unknown'}) supports tools: ${capabilities.supportsTools}`,
    );
    return capabilities;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return { supportsTools: false, maxTokens: null, name: null };
  }
}

/**
 * Check if a model supports tool calling (server-only — uses Prisma).
 */
export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  const capabilities = await getChatModelCapabilities(modelIdentifier);
  return capabilities.supportsTools;
}
