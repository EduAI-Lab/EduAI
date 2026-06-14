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
  const defaultOutput = providerId === 'vllm' ? 2048 : 4096;

  if (dbMaxTokens && dbMaxTokens > 0 && dbMaxTokens < 8192) {
    return Math.min(dbMaxTokens, defaultOutput, envCeiling);
  }

  return Math.min(defaultOutput, envCeiling);
}

/** Fit completion tokens inside what remains after the prompt (+ safety buffer). */
export function capMaxOutputTokensForPrompt(params: {
  contextWindow: number;
  estimatedInputTokens: number;
  desiredMaxOutput: number;
  minOutput?: number;
  safetyBuffer?: number;
}): number {
  const minOutput = params.minOutput ?? 256;
  const safetyBuffer = params.safetyBuffer ?? 384;
  const toolDefinitionAllowance = 512;
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

/**
 * Check if a model supports tool calling (server-only — uses Prisma).
 */
export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  try {
    const model = await resolveActiveChatModel(modelIdentifier);
    const supportsTools = model?.supportsTools ?? false;
    console.log(
      `Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: ${supportsTools}`,
    );
    return supportsTools;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
