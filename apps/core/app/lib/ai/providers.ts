/**
 * Server-side AI provider registry (uses env + SDK clients).
 * Client-safe helpers live in providers.shared.ts.
 */

import { createProviderRegistry } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';

export type {
  SupportedProvider,
  UserProviderSettings,
  ProviderConfig,
} from './providers.shared';

export {
  PROVIDER_CONFIGS,
  validateProviderConfig,
  getAvailableProviders,
  getProviderConfig,
  isProviderConfigured,
  getModelIdentifier,
  parseModelIdentifier,
  filterModelsForApiKeys,
  mergeServerOpenRouterApiKey,
} from './providers.shared';

import type { UserProviderSettings } from './providers.shared';
import { parseModelIdentifier } from './providers.shared';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function createOpenRouterClient(apiKey: string) {
  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    undefined;

  return createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      'X-Title': process.env.OPENROUTER_APP_TITLE?.trim() || 'EduAI',
    },
  });
}

export function createAIProviderRegistry(userSettings: UserProviderSettings) {
  const providers: Record<string, any> = {};

  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) {
    providers.openai = createOpenAI({
      apiKey: userSettings.openai.apiKey,
    });
  }

  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: userSettings.google.apiKey,
    });
  }

  if (userSettings.openrouter?.isEnabled && userSettings.openrouter?.apiKey) {
    providers.openrouter = createOpenRouterClient(userSettings.openrouter.apiKey);
  }

  if (userSettings.ollama?.isEnabled) {
    let baseURL = userSettings.ollama?.baseUrl ||
                  process.env.OLLAMA_BASE_URL ||
                  'http://localhost:11434';

    if (!baseURL.endsWith('/api')) {
      baseURL = baseURL.replace(/\/$/, '') + '/api';
    }

    providers.ollama = createOllama({
      baseURL,
    });
  }

  return createProviderRegistry(providers, { separator: ':' });
}

export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  try {
    const { default: prisma } = await import('../prisma.server');

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
      orderBy: { updatedAt: "desc" },
      select: {
        supportsTools: true,
        name: true,
      },
    });

    const supportsTools = model?.supportsTools ?? false;
    console.log(`Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: ${supportsTools}`);
    return supportsTools;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
