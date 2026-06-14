import prisma from '../prisma.server';
import { parseModelIdentifier, type SupportedProvider } from './providers';

export type ActiveChatModel = {
  name: string;
  supportsTools: boolean;
  /** DB maxTokens — often total context window for vLLM, not output-only. */
  maxTokens: number | null;
};

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

/**
 * Cap completion tokens for tool-calling streams.
 * DB maxTokens is often the model context window (e.g. 16384 on vLLM), not a safe output limit.
 */
export function resolveMaxOutputTokens(
  dbMaxTokens: number | null | undefined,
  providerId?: SupportedProvider,
): number {
  const envCeiling = Math.min(
    128_000,
    Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 8192),
  );
  const defaultOutput = providerId === 'vllm' ? 4096 : 8192;

  if (dbMaxTokens && dbMaxTokens > 0) {
    // Values above env ceiling are usually total context — reserve room for the prompt.
    if (dbMaxTokens > envCeiling) {
      const fromContext = Math.floor(dbMaxTokens * 0.25);
      return Math.min(envCeiling, Math.max(1024, Math.min(fromContext, defaultOutput)));
    }
    return Math.min(dbMaxTokens, envCeiling);
  }

  return Math.min(defaultOutput, envCeiling);
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
