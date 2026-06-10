import { useState, useEffect, useCallback } from 'react';
import type { UserProviderSettings } from '~/lib/ai/providers.shared';

export interface ApiKeyData {
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl?: string;
  isEnabled: boolean;
}

export function useApiKeys() {
  const [apiKeys, setApiKeys] = useState<UserProviderSettings>({});
  const [isLoading, setIsLoading] = useState(true);

  // Load API keys from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('edu-ai-api-keys');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setApiKeys(parsed);
      } catch (error) {
        console.error('Failed to parse stored API keys:', error);
      }
    }
    setIsLoading(false);
  }, []);

  // Save API keys to localStorage whenever they change
  const saveApiKeys = useCallback((newKeys: UserProviderSettings) => {
    setApiKeys(newKeys);
    localStorage.setItem('edu-ai-api-keys', JSON.stringify(newKeys));
  }, []);

  // Update a specific provider's settings
  const updateProviderSettings = useCallback((providerId: string, settings: {
    apiKey?: string;
    baseUrl?: string;
    isEnabled: boolean;
  }) => {
    const newKeys = {
      ...apiKeys,
      [providerId]: {
        ...apiKeys[providerId],
        ...settings,
      },
    };
    saveApiKeys(newKeys);
  }, [apiKeys, saveApiKeys]);

  // Remove a provider's settings
  const removeProviderSettings = useCallback((providerId: string) => {
    const { [providerId]: removed, ...rest } = apiKeys;
    saveApiKeys(rest);
  }, [apiKeys, saveApiKeys]);

  // Get valid API keys for providers that are enabled and have keys (or don't require keys)
  const getValidApiKeys = useCallback(() => {
    const validKeys: UserProviderSettings = {};

    Object.entries(apiKeys).forEach(([providerId, settings]) => {
      // Ollama doesn't require an API key, just needs to be enabled
      if (providerId === 'ollama') {
        if (settings.isEnabled) {
          validKeys[providerId] = settings;
        }
      } else {
        // Other providers need both enabled and API key
        if (settings.isEnabled && settings.apiKey) {
          validKeys[providerId] = settings;
        }
      }
    });

    return validKeys;
  }, [apiKeys]);

  // Check if a provider is configured
  const isProviderConfigured = useCallback((providerId: string) => {
    // Ollama doesn't require an API key, just needs to be enabled
    if (providerId === 'ollama') {
      return !!(apiKeys[providerId]?.isEnabled);
    }
    return !!(apiKeys[providerId]?.isEnabled && apiKeys[providerId]?.apiKey);
  }, [apiKeys]);

  // Get provider settings
  const getProviderSettings = useCallback((providerId: string) => {
    return apiKeys[providerId];
  }, [apiKeys]);

  return {
    apiKeys,
    isLoading,
    updateProviderSettings,
    removeProviderSettings,
    getValidApiKeys,
    isProviderConfigured,
    getProviderSettings,
  };
}