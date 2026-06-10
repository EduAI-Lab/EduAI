/**
 * Client-safe AI provider helpers (no server-only imports).
 */

export type SupportedProvider = 'openai' | 'google' | 'ollama' | 'openrouter';

export interface UserProviderSettings {
  [key: string]: {
    apiKey?: string;
    isEnabled: boolean;
    baseUrl?: string;
  };
}

export interface ProviderConfig {
  id: SupportedProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
}

export const PROVIDER_CONFIGS: Record<SupportedProvider, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Advanced AI models including GPT-4, GPT-4o, and o1',
    requiresApiKey: true,
    envVarName: 'OPENAI_API_KEY',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models for multimodal AI applications',
    requiresApiKey: true,
    envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local AI models running on Ollama',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/api',
    envVarName: 'OLLAMA_BASE_URL',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified access to cloud models via OpenRouter',
    requiresApiKey: true,
    envVarName: 'OPENROUTER_API_KEY',
  },
};

export function validateProviderConfig(
  providerId: SupportedProvider,
  settings: { apiKey?: string; baseUrl?: string },
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

export function getAvailableProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS);
}

export function getProviderConfig(providerId: SupportedProvider): ProviderConfig | null {
  return PROVIDER_CONFIGS[providerId] || null;
}

export function isProviderConfigured(
  providerId: SupportedProvider,
  userSettings: UserProviderSettings,
): boolean {
  const userConfig = userSettings[providerId];
  const providerConfig = PROVIDER_CONFIGS[providerId];

  if (!userConfig?.isEnabled) return false;

  if (providerConfig?.requiresApiKey && !userConfig.apiKey) {
    return false;
  }

  return true;
}

export function getModelIdentifier(providerId: SupportedProvider, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function parseModelIdentifier(
  identifier: string,
): { providerId: SupportedProvider; modelId: string } | null {
  if (!identifier || typeof identifier !== 'string') return null;

  const firstColonIndex = identifier.indexOf(':');
  if (firstColonIndex === -1) return null;

  const providerId = identifier.slice(0, firstColonIndex);
  const modelId = identifier.slice(firstColonIndex + 1);

  if (!providerId || !modelId) return null;
  if (!Object.keys(PROVIDER_CONFIGS).includes(providerId)) return null;

  return { providerId: providerId as SupportedProvider, modelId };
}

export function filterModelsForApiKeys<T extends { id: string }>(
  models: T[],
  userSettings: UserProviderSettings,
  options?: { serverOpenRouterAvailable?: boolean },
): T[] {
  return models.filter((model) => {
    const parsed = parseModelIdentifier(model.id);
    if (!parsed) return false;
    if (parsed.providerId === "openrouter" && options?.serverOpenRouterAvailable) {
      return true;
    }
    return isProviderConfigured(parsed.providerId, userSettings);
  });
}

/** Use server OPENROUTER_API_KEY when the client omitted a browser-stored key. */
export function mergeServerOpenRouterApiKey(
  settings: UserProviderSettings,
  model: string,
  serverKey?: string | null,
): UserProviderSettings {
  const parsed = parseModelIdentifier(model);
  if (parsed?.providerId !== "openrouter") return settings;
  if (isProviderConfigured("openrouter", settings)) return settings;

  const apiKey = serverKey?.trim();
  if (!apiKey) return settings;

  return {
    ...settings,
    openrouter: { apiKey, isEnabled: true },
  };
}
