import prisma from '../prisma.server';
import { parseModelIdentifier } from './providers';

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
    const parsed = parseModelIdentifier(modelIdentifier);
    if (!parsed) {
      console.log(`Invalid model identifier: ${modelIdentifier}`);
      return { supportsTools: false, maxTokens: null, name: null };
    }

    const model = await prisma.aIModel.findFirst({
      where: {
        modelId: parsed.modelId,
        provider: {
          name: parsed.providerId,
        },
        isActive: true,
      },
      select: {
        supportsTools: true,
        maxTokens: true,
        name: true,
        modelId: true,
        type: true,
      },
    });

    const capabilities: ChatModelCapabilities = {
      supportsTools: Boolean(model?.supportsTools),
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
