import prisma from '../prisma.server';
import { parseModelIdentifier } from './providers';

/**
 * Check if a model supports tool calling (server-only — uses Prisma).
 */
export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  try {
    const parsed = parseModelIdentifier(modelIdentifier);
    if (!parsed) {
      console.log(`Invalid model identifier: ${modelIdentifier}`);
      return false;
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
        name: true,
        provider: { select: { name: true } },
      },
    });

    if (!model) {
      console.log(`Model ${modelIdentifier} not found in DB`);
      return false;
    }

    // vllm/ollama often support tools even when the DB flag was never toggled on.
    if (
      (parsed.providerId === "vllm" || parsed.providerId === "ollama") &&
      !model.supportsTools
    ) {
      return true;
    }

    const supportsTools = model.supportsTools;
    console.log(
      `Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: ${supportsTools}`,
    );
    return supportsTools;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
