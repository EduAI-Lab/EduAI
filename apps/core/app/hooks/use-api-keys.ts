import { useSyncExternalStore, useCallback } from "react";
import { useCurrentUserId } from "~/contexts/current-user";
import type { UserProviderSettings } from "~/lib/ai/provider-types";
import { LOCAL_INFERENCE_PROVIDERS } from "~/lib/ai/provider-types";
import { isBrowser } from "@eduai/ui/runtime-env";

/**
 * Sentinel stored in the client-side state when the real key lives in the DB.
 * Never sent back to the server — the server loads the decrypted key directly.
 */
export const DB_STORED_KEY = "__db_stored__";

const LEGACY_STORAGE_KEY = "edu-ai-api-keys";

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
let storeOwnerId: string | null = null;
let loadGeneration = 0;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function setState(next: ApiKeysStore) {
  storeState = next;
  emitChange();
}

function normalizeOwnerId(userId: string | null): string {
  return userId?.trim() || "__anonymous__";
}

// Load once per authenticated account, not once per JavaScript runtime. Core
// uses client-side logout/login navigation, so the same module can serve two
// different users without a document reload.
function ensureLoaded(userId: string | null) {
  if (!isBrowser()) return;

  const ownerId = normalizeOwnerId(userId);
  if (storeOwnerId !== ownerId) {
    storeOwnerId = ownerId;
    fetchInitiated = false;
    loadGeneration += 1;
    storeState = { data: {}, isLoading: true };
  }

  if (fetchInitiated) return;
  fetchInitiated = true;
  const generation = loadGeneration;

  // The old key was global plaintext with no owner metadata. It cannot be
  // safely attributed to the current account, so never upload or reuse it.
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  fetch("/api/user-provider-settings", { credentials: "include" })
    .then((r) => {
      if (r.status === 401) {
        // Session expired/unauthenticated: surface as no keys rather than
        // falling back to a stale, possibly-mismatched localStorage keyset.
        console.error("Failed to load provider settings: unauthorized");
        setState({ data: {}, isLoading: false });
        return null;
      }
      if (!r.ok) throw new Error(`Failed to load provider settings: ${r.status}`);
      return r.json() as Promise<ServerRow[]>;
    })
    .then((rows) => {
      if (rows === null || storeOwnerId !== ownerId || loadGeneration !== generation) return;
      const data = rowsToSettings(rows);
      setState({ data, isLoading: false });
    })
    .catch(() => {
      if (storeOwnerId !== ownerId || loadGeneration !== generation) return;
      setState({ data: {}, isLoading: false });
    });
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

export function useApiKeys(ownerIdOverride?: string | null) {
  const contextualOwnerId = useCurrentUserId();
  const ownerId = normalizeOwnerId(ownerIdOverride ?? contextualOwnerId);
  ensureLoaded(ownerId);

  const store = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => storeState,
    () => ({ data: {}, isLoading: true }) satisfies ApiKeysStore,
  );

  const apiKeys = store.data;
  const isLoading = store.isLoading;

  const updateProviderSettings = useCallback(
    (providerId: string, settings: { apiKey?: string; baseUrl?: string; isEnabled: boolean }) => {
      const mutationOwnerId = ownerId;
      const previous = storeState;

      // Optimistic: show change immediately.
      optimisticSet(providerId, {
        ...settings,
        apiKey: settings.apiKey ?? storeState.data[providerId]?.apiKey,
      });

      void fetch("/api/user-provider-settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: providerId, ...settings }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to save provider settings: ${response.status}`);
          }
          if (storeOwnerId === mutationOwnerId && settings.apiKey) {
            optimisticSet(providerId, { apiKey: DB_STORED_KEY });
          }
        })
        .catch((error) => {
          if (storeOwnerId === mutationOwnerId) setState(previous);
          console.error(error);
        });
    },
    [ownerId],
  );

  const removeProviderSettings = useCallback(
    (providerId: string) => {
      const mutationOwnerId = ownerId;
      const previous = storeState;
      optimisticDelete(providerId);

      void fetch("/api/user-provider-settings", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: providerId }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to remove provider settings: ${response.status}`);
          }
        })
        .catch((error) => {
          if (storeOwnerId === mutationOwnerId) setState(previous);
          console.error(error);
        });
    },
    [ownerId],
  );

  const getValidApiKeys = useCallback((): UserProviderSettings => {
    const valid: UserProviderSettings = {};
    for (const [providerId, settings] of Object.entries(apiKeys)) {
      if (
        LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])
      ) {
        if (settings.isEnabled) valid[providerId] = settings;
      } else {
        if (settings.isEnabled && settings.apiKey) valid[providerId] = settings;
      }
    }
    return valid;
  }, [apiKeys]);

  const isProviderConfigured = useCallback(
    (providerId: string) => {
      if (
        LOCAL_INFERENCE_PROVIDERS.includes(providerId as (typeof LOCAL_INFERENCE_PROVIDERS)[number])
      ) {
        return !!apiKeys[providerId]?.isEnabled;
      }
      return !!(apiKeys[providerId]?.isEnabled && apiKeys[providerId]?.apiKey);
    },
    [apiKeys],
  );

  const getProviderSettings = useCallback((providerId: string) => apiKeys[providerId], [apiKeys]);

  return {
    apiKeys,
    isLoading,
    updateProviderSettings,
    removeProviderSettings,
    getValidApiKeys,
    isProviderConfigured,
    getProviderSettings,
    /** @deprecated Use updateProviderSettings instead. */
    saveApiKeys: useCallback((newKeys: UserProviderSettings) => {
      setState({ data: newKeys, isLoading: false });
    }, []),
  };
}

/** Resets module-level state. Only for use in tests. */
export function __resetForTesting(): void {
  storeState = { data: {}, isLoading: true };
  fetchInitiated = false;
  storeOwnerId = null;
  loadGeneration = 0;
  listeners.clear();
}
