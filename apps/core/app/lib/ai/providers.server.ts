import prisma from '../prisma.server';
import { parseModelIdentifier } from './providers';
import { allowsSupportsToolsToggle } from './model-tool-capability';

/**
 * Check if a model supports tool calling (server-only — uses Prisma).
 * Applies #264 guardrails even when legacy rows still have supportsTools=true.
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

    if (!model?.supportsTools) {
      console.log(
        `Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: false`,
      );
      return false;
    }

    const allowed = allowsSupportsToolsToggle(model.modelId, model.type);
    console.log(
      `Model ${modelIdentifier} (${model.name}) supports tools: ${allowed}`,
    );
    return allowed;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
