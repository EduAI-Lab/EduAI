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
        modelId: true,
        type: true,
      },
    });

    const supportsTools = Boolean(model?.supportsTools);
    console.log(
      `Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: ${supportsTools}`,
    );
    return supportsTools;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
