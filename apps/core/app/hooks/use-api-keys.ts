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
    .then((r) => {
      if (r.status === 401) {
        // Session expired/unauthenticated: surface as no keys rather than
        // falling back to a stale, possibly-mismatched localStorage keyset.
        console.error('Failed to load provider settings: unauthorized');
        setState({ data: {}, isLoading: false });
        return null;
      }
      if (!r.ok) throw new Error(`Failed to load provider settings: ${r.status}`);
      return r.json() as Promise<ServerRow[]>;
    })
    .then((rows) => {
      if (rows === null) return;
      const data = rowsToSettings(rows);
      const configuredProviders = new Set(rows.map((row) => row.providerName));

      // Migrate any legacy localStorage key that doesn't already have a DB
      // row, rather than skipping migration entirely once any row exists.
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        try {
          const localKeys = JSON.parse(raw) as UserProviderSettings;
          const toMigrate = Object.fromEntries(
            Object.entries(localKeys).filter(
              ([providerName, v]) => v.isEnabled && !configuredProviders.has(providerName),
            ),
          );
          if (Object.keys(toMigrate).length > 0) {
            setState({ data: { ...data, ...toMigrate }, isLoading: false });
            migrateFromLocalStorage(localKeys, toMigrate);
            return;
          }
        } catch {
          // ignore parse errors — fall through to server state
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

async function migrateFromLocalStorage(
  allLocalKeys: UserProviderSettings,
  toMigrate: UserProviderSettings,
): Promise<void> {
  const entries = Object.entries(toMigrate);
  const results = await Promise.allSettled(
    entries.map(([providerName, settings]) =>
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
      }).then((r) => {
        if (!r.ok) throw new Error(`Migration failed for ${providerName}: ${r.status}`);
      }),
    ),
  );

  // Only drop the legacy keys that actually persisted to the server; keep
  // the rest in localStorage so a failed write doesn't permanently lose the
  // user's key.
  const migratedProviders = new Set(
    entries
      .filter((_, i) => results[i].status === 'fulfilled')
      .map(([providerName]) => providerName),
  );
  const remaining = Object.fromEntries(
    Object.entries(allLocalKeys).filter(([providerName]) => !migratedProviders.has(providerName)),
  );

  if (Object.keys(remaining).length > 0) {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(remaining));
  } else {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
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
