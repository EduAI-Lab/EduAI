/**
 * AI Provider Registry for EduAI
 * Dynamic provider management with user-provided API keys
 */

import { createProviderRegistry } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';

// Supported provider types
export type SupportedProvider = 'openai' | 'google' | 'ollama';

// User provider settings interface
export interface UserProviderSettings {
  [key: string]: {
    apiKey?: string;
    isEnabled: boolean;
    baseUrl?: string;
  };
}

// Provider configuration interface
export interface ProviderConfig {
  id: SupportedProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
}

// Provider configurations (static metadata only)
export const PROVIDER_CONFIGS: Record<SupportedProvider, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Advanced AI models including GPT-4, GPT-4o, and o1',
    requiresApiKey: true,
    envVarName: 'OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models for multimodal AI applications',
    requiresApiKey: true,
    envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local AI models running on Ollama',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/api',
    envVarName: 'OLLAMA_BASE_URL'
  }
};

/**
 * Creates a dynamic provider registry with user-provided settings.
 * Server env keys take priority over user-provided keys.
 * When server key exists, provider is always enabled (no user action needed).
 */
export function createAIProviderRegistry(userSettings: UserProviderSettings) {
  const providers: Record<string, any> = {};

  // OpenAI - server key takes priority and auto-enables, fallback to user key
  const serverOpenaiKey = process.env.OPENAI_API_KEY;
  const userOpenaiKey = userSettings.openai?.apiKey;
  const openaiKey = serverOpenaiKey || userOpenaiKey;
  const openaiEnabled = serverOpenaiKey ? true : userSettings.openai?.isEnabled;
  
  if (openaiEnabled && openaiKey) {
    providers.openai = createOpenAI({
      apiKey: openaiKey,
    });
  }

  // Google AI - server key takes priority and auto-enables, fallback to user key
  const serverGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const userGoogleKey = userSettings.google?.apiKey;
  const googleKey = serverGoogleKey || userGoogleKey;
  const googleEnabled = serverGoogleKey ? true : userSettings.google?.isEnabled;
  
  if (googleEnabled && googleKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: googleKey,
    });
  }

  // Ollama - always available if enabled (no API key required)
  if (userSettings.ollama?.isEnabled) {
    let baseURL = userSettings.ollama?.baseUrl ||
                  process.env.OLLAMA_BASE_URL ||
                  'http://localhost:11434';

    // Ensure the URL ends with /api for Ollama compatibility
    if (!baseURL.endsWith('/api')) {
      baseURL = baseURL.replace(/\/$/, '') + '/api';
    }

    providers.ollama = createOllama({
      baseURL,
    });
  }

  // Create and return the registry
  return createProviderRegistry(providers, { separator: ':' });
}

/**
 * Returns which providers have server-side API keys configured.
 * Used by frontend to hide API key input when server key is available.
 */
export function getServerConfiguredProviders(): Record<SupportedProvider, boolean> {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    google: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    ollama: true, // Ollama doesn't require API key
  };
}

/**
 * Validates provider configuration
 */
export function validateProviderConfig(
  providerId: SupportedProvider,
  settings: { apiKey?: string; baseUrl?: string }
): { isValid: boolean; error?: string } {
  const config = PROVIDER_CONFIGS[providerId];

  if (!config) {
    return { isValid: false, error: 'Unsupported provider' };
  }

  if (config.requiresApiKey && !settings.apiKey) {
    return { isValid: false, error: 'API key is required for this provider' };
  }

  return { isValid: true };
}

/**
 * Get available provider configurations
 */
export function getAvailableProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS);
}

/**
 * Get provider configuration by ID
 */
export function getProviderConfig(providerId: SupportedProvider): ProviderConfig | null {
  return PROVIDER_CONFIGS[providerId] || null;
}

/**
 * Check if provider is configured in user settings
 */
export function isProviderConfigured(
  providerId: SupportedProvider,
  userSettings: UserProviderSettings
): boolean {
  const userConfig = userSettings[providerId];
  const providerConfig = PROVIDER_CONFIGS[providerId];

  if (!userConfig?.isEnabled) return false;

  // For providers that require API key, check if it's provided
  if (providerConfig?.requiresApiKey && !userConfig.apiKey) {
    return false;
  }

  return true;
}

/**
 * Get model identifier for registry usage (provider:model format)
 */
export function getModelIdentifier(providerId: SupportedProvider, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/**
 * Parse model identifier to extract provider and model IDs
 */
export function parseModelIdentifier(identifier: string): { providerId: SupportedProvider; modelId: string } | null {
  if (!identifier || typeof identifier !== 'string') return null;

  // Allow additional colons in modelId (e.g., "ollama:gpt-oss:120b") by splitting on the first colon only
  const firstColonIndex = identifier.indexOf(':');
  if (firstColonIndex === -1) return null;

  const providerId = identifier.slice(0, firstColonIndex);
  const modelId = identifier.slice(firstColonIndex + 1);

  if (!providerId || !modelId) return null;
  if (!Object.keys(PROVIDER_CONFIGS).includes(providerId)) return null;

  return { providerId: providerId as SupportedProvider, modelId };
}

/**
 * Check if a model supports tool calling
 * @param modelIdentifier - The model identifier in format "provider:modelId"
 * @returns Promise<boolean> - Whether the model supports tool calling
 */
export async function modelSupportsTools(modelIdentifier: string): Promise<boolean> {
  try {
    // Import prisma here to avoid circular dependencies
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
          name: parsed.providerId
        },
        isActive: true
      },
      select: {
        supportsTools: true,
        name: true
      }
    });

    const supportsTools = model?.supportsTools ?? false;
    console.log(`Model ${modelIdentifier} (${model?.name || 'unknown'}) supports tools: ${supportsTools}`);
    return supportsTools;
  } catch (error) {
    console.error('Error checking model tool support:', error);
    return false;
  }
}
