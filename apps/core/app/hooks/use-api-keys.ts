import { useSyncExternalStore, useCallback } from 'react';
import type { UserProviderSettings } from '~/lib/ai/provider-types';
import { LOCAL_INFERENCE_PROVIDERS } from '~/lib/ai/provider-types';

/**
 * Sentinel stored in the client-side state when the real key lives in the DB.
 * Never sent back to the server — the server loads the decrypted key directly.
 */
export const DB_STORED_KEY = '__db_stored__';

const LEGACY_STORAGE_KEY = 'edu-ai-api-keys';

// ---------------------------------------------------------------------------
// Server row shape returned by GET /api/user-provider-settings
// ---------------------------------------------------------------------------

type ServerRow = {
  providerName: string;
  isEnabled: boolean;
  hasKey: boolean;
  baseUrl: string | null;
};

function rowsToSettings(rows: ServerRow[]): UserProviderSettings {
  const settings: UserProviderSettings = {};
  for (const row of rows) {
    settings[row.providerName] = {
      isEnabled: row.isEnabled,
      apiKey: row.hasKey ? DB_STORED_KEY : undefined,
      baseUrl: row.baseUrl ?? undefined,
    };
  }
  return settings;
}

// ---------------------------------------------------------------------------
// Module-level store — shared across all hook instances on the same page.
// ---------------------------------------------------------------------------

interface ApiKeysStore {
  data: UserProviderSettings;
  isLoading: boolean;
}

let storeState: ApiKeysStore = { data: {}, isLoading: true };
let fetchInitiated = false;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function setState(next: ApiKeysStore) {
  storeState = next;
  emitChange();
}

// One-time fetch on the first component mount.
function ensureLoaded() {
  if (fetchInitiated || typeof window === 'undefined') return;
  fetchInitiated = true;

  fetch('/api/user-provider-settings', { credentials: 'include' })
    .then((r) => r.json() as Promise<ServerRow[]>)
    .then((rows) => {
      const data = rowsToSettings(rows);

      // One-time migration: if the server has nothing yet, promote localStorage keys.
      if (Object.keys(data).length === 0) {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) {
          try {
            const localKeys = JSON.parse(raw) as UserProviderSettings;
            setState({ data: localKeys, isLoading: false });
            migrateFromLocalStorage(localKeys);
            return;
          } catch {
            // ignore parse errors — fall through to empty state
          }
        }
      }

      setState({ data, isLoading: false });
    })
    .catch(() => {
      // Server unreachable: fall back to localStorage so offline devs aren't blocked.
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      try {
        const data = raw ? (JSON.parse(raw) as UserProviderSettings) : {};
        setState({ data, isLoading: false });
      } catch {
        setState({ data: {}, isLoading: false });
      }
    });
}

async function migrateFromLocalStorage(localKeys: UserProviderSettings): Promise<void> {
  const tasks = Object.entries(localKeys)
    .filter(([, v]) => v.isEnabled)
    .map(([providerName, settings]) =>
      fetch('/api/user-provider-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerName,
          isEnabled: settings.isEnabled,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
        }),
      }),
    );

  await Promise.allSettled(tasks);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Store mutation helpers (optimistic update + API persist)
// ---------------------------------------------------------------------------

function optimisticSet(providerName: string, patch: Partial<UserProviderSettings[string]>) {
  const current = storeState.data[providerName] ?? { isEnabled: false };
  setState({
    data: { ...storeState.data, [providerName]: { ...current, ...patch } },
    isLoading: false,
  });
}

function optimisticDelete(providerName: string) {
  const { [providerName]: _removed, ...rest } = storeState.data;
  setState({ data: rest, isLoading: false });
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export function useApiKeys() {
  ensureLoaded();

  const store = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => storeState,
    () => ({ data: {}, isLoading: true } satisfies ApiKeysStore),
  );

  const apiKeys = store.data;
  const isLoading = store.isLoading;

  const updateProviderSettings = useCallback(
    (
      providerId: string,
      settings: { apiKey?: string; baseUrl?: string; isEnabled: boolean },
    ) => {
      // Optimistic: show change immediately.
      optimisticSet(providerId, {
        ...settings,
        apiKey: settings.apiKey ?? storeState.data[providerId]?.apiKey,
      });

      fetch('/api/user-provider-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerName: providerId, ...settings }),
      }).catch(console.error);
    },
    [],
  );

  const removeProviderSettings = useCallback((providerId: string) => {
    optimisticDelete(providerId);

    fetch('/api/user-provider-settings', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerName: providerId }),
    }).catch(console.error);
  }, []);

  const getValidApiKeys = useCallback((): UserProviderSettings => {
    const valid: UserProviderSettings = {};
    for (const [providerId, settings] of Object.entries(apiKeys)) {
      if (LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])) {
        if (settings.isEnabled) valid[providerId] = settings;
      } else {
        if (settings.isEnabled && settings.apiKey) valid[providerId] = settings;
      }
    }
    return valid;
  }, [apiKeys]);

  const isProviderConfigured = useCallback(
    (providerId: string) => {
      if (LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])) {
        return !!(apiKeys[providerId]?.isEnabled);
      }
      return !!(apiKeys[providerId]?.isEnabled && apiKeys[providerId]?.apiKey);
    },
    [apiKeys],
  );

  const getProviderSettings = useCallback(
    (providerId: string) => apiKeys[providerId],
    [apiKeys],
  );

  return {
    apiKeys,
    isLoading,
    updateProviderSettings,
    removeProviderSettings,
    getValidApiKeys,
    isProviderConfigured,
    getProviderSettings,
    /** @deprecated Use updateProviderSettings instead. */
    saveApiKeys: useCallback(
      (newKeys: UserProviderSettings) => {
        setState({ data: newKeys, isLoading: false });
      },
      [],
    ),
  };
}

/** Resets module-level state. Only for use in tests. */
export function __resetForTesting(): void {
  storeState = { data: {}, isLoading: true };
  fetchInitiated = false;
  listeners.clear();
}
