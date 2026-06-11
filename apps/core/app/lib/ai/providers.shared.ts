/**
 * Client-safe AI provider helpers (no server-only imports).
 */

export type {
  ProviderConfig,
  SupportedProvider,
  UserProviderSettings,
} from './provider-types';

export {
  LOCAL_INFERENCE_PROVIDERS,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
} from './provider-types';

import {
  parseModelIdentifier,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type SupportedProvider,
  type UserProviderSettings,
} from './provider-types';

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

export function filterModelsForApiKeys<T extends { id: string }>(
  models: T[],
  userSettings: UserProviderSettings,
  options?: { serverOpenRouterAvailable?: boolean },
): T[] {
  return models.filter((model) => {
    const parsed = parseModelIdentifier(model.id);
    if (!parsed) return false;
    if (parsed.providerId === 'openrouter' && options?.serverOpenRouterAvailable) {
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
  if (parsed?.providerId !== 'openrouter') return settings;
  if (isProviderConfigured('openrouter', settings)) return settings;

  const apiKey = serverKey?.trim();
  if (!apiKey) return settings;

  return {
    ...settings,
    openrouter: { apiKey, isEnabled: true },
  };
}
