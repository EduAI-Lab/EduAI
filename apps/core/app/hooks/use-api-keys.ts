import { useSyncExternalStore, useCallback } from 'react';
import type { UserProviderSettings } from '~/lib/ai/provider-types';
import { LOCAL_INFERENCE_PROVIDERS } from '~/lib/ai/provider-types';

export interface ApiKeyData {
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl?: string;
  isEnabled: boolean;
}

const STORAGE_KEY = 'edu-ai-api-keys';

// ---------------------------------------------------------------------------
// Shared external store — one JS module instance, shared across all call sites
// on the same page. Any write in one component re-renders ALL consumers,
// eliminating the stale-state bug that required a full page refresh.
// ---------------------------------------------------------------------------

type Listener = () => void;

interface ApiKeysStore {
  data: UserProviderSettings;
  /** true only during the very first synchronous render before localStorage is read */
  isLoading: boolean;
}

let storeState: ApiKeysStore = { data: {}, isLoading: true };
/**
 * The raw JSON string we last wrote to / read from localStorage.
 * Tracked so getSnapshot can detect out-of-band mutations (e.g. test teardown
 * calling localStorage.clear()) without expensive stringify comparisons.
 */
let lastKnownRaw: string | null = null;
const listeners = new Set<Listener>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: ApiKeysStore, rawJson: string | null) {
  storeState = next;
  lastKnownRaw = rawJson;
  emitChange();
}

function parseStorage(): { data: UserProviderSettings; raw: string | null } {
  if (typeof window === 'undefined') return { data: {}, raw: null };
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { data: {}, raw: null };
  try {
    return { data: JSON.parse(raw) as UserProviderSettings, raw };
  } catch (error) {
    console.error('Failed to parse stored API keys:', error);
    return { data: {}, raw: null };
  }
}

/**
 * useSyncExternalStore snapshot function.
 *
 * On every call we check whether the raw localStorage value matches what we
 * last recorded (lastKnownRaw). If it differs — because the user called
 * saveApiKeys (expected), or because tests cleared/populated localStorage
 * out-of-band — we re-hydrate synchronously. This keeps the hook correct
 * across test runs (which share the module but clear localStorage in
 * beforeEach) without requiring a Provider wrapper.
 */
function getSnapshot(): ApiKeysStore {
  if (typeof window === 'undefined') return storeState;

  const currentRaw = window.localStorage.getItem(STORAGE_KEY);
  // Reconcile whenever: (a) still in the initial loading state, or (b) the raw
  // localStorage value changed externally (cleared by tests, or written by
  // another tab before the storage event fires).
  if (storeState.isLoading || currentRaw !== lastKnownRaw) {
    let data: UserProviderSettings = {};
    if (currentRaw) {
      try {
        data = JSON.parse(currentRaw) as UserProviderSettings;
      } catch (error) {
        console.error('Failed to parse stored API keys:', error);
      }
    }
    storeState = { data, isLoading: false };
    lastKnownRaw = currentRaw;
  }
  return storeState;
}

function getServerSnapshot(): ApiKeysStore {
  // SSR: return a stable empty loading state (no window access).
  return { data: {}, isLoading: true };
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab / cross-window sync via storage events.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const { data } = parseStorage();
    setState({ data, isLoading: false }, event.newValue);
  });
}

// ---------------------------------------------------------------------------
// Public hook — identical external API to the previous useState version.
// No Provider wrapper required; works standalone in tests.
// ---------------------------------------------------------------------------

export function useApiKeys() {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const apiKeys = store.data;
  const isLoading = store.isLoading;

  const saveApiKeys = useCallback((newKeys: UserProviderSettings) => {
    const rawJson = JSON.stringify(newKeys);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, rawJson);
    }
    setState({ data: newKeys, isLoading: false }, rawJson);
  }, []);

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

  const removeProviderSettings = useCallback((providerId: string) => {
    const { [providerId]: _removed, ...rest } = apiKeys;
    saveApiKeys(rest);
  }, [apiKeys, saveApiKeys]);

  const getValidApiKeys = useCallback(() => {
    const validKeys: UserProviderSettings = {};

    Object.entries(apiKeys).forEach(([providerId, settings]) => {
      if (LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])) {
        if (settings.isEnabled) {
          validKeys[providerId] = settings;
        }
      } else {
        if (settings.isEnabled && settings.apiKey) {
          validKeys[providerId] = settings;
        }
      }
    });

    return validKeys;
  }, [apiKeys]);

  const isProviderConfigured = useCallback((providerId: string) => {
    if (LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])) {
      return !!(apiKeys[providerId]?.isEnabled);
    }
    return !!(apiKeys[providerId]?.isEnabled && apiKeys[providerId]?.apiKey);
  }, [apiKeys]);

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
    /** @deprecated Prefer updateProviderSettings; exposed for legacy call sites. */
    saveApiKeys,
  };
}
