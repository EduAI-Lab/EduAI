import { useCallback, useEffect, useState } from "react";
import { useLocalUser } from "~/hooks/useLocalUser";
import api from "~/lib/api";
import {
  API_KEYS_CLEARED_EVENT,
  CORE_STORED_KEY,
  loadApiKeysFromStorage,
  removeApiKeyFromStorage,
} from "~/lib/provider-keys";

export type UseApiKeysResult = {
  /** provider id → key. */
  keys: Record<string, string>;
  /** false until localStorage has been read (post-hydration). */
  loaded: boolean;
  hasKey: (provider: string) => boolean;
  getKey: (provider: string) => string;
  setKey: (provider: string, key: string) => Promise<void>;
  removeKey: (provider: string) => Promise<void>;
  validateKey: (provider: string, key: string) => Promise<{ valid: boolean; error?: string }>;
};

/**
 * Owns the student's BYOK provider keys (localStorage-backed). Consumed by both
 * the chat composer's quick-add and the Settings → Providers tab, so key entry
 * is the same everywhere — mirroring Core's `use-api-keys` + `ApiKeySettings`.
 */
export function useApiKeys(): UseApiKeysResult {
  const { user } = useLocalUser();
  const userId = user?.id ?? null;
  const [accountKeys, setAccountKeys] = useState<{
    userId: string | null;
    keys: Record<string, string>;
    loaded: boolean;
  }>({ userId: null, keys: {}, loaded: false });
  const isCurrentAccount = accountKeys.userId === userId;
  const keys = isCurrentAccount ? accountKeys.keys : {};
  const loaded = isCurrentAccount && accountKeys.loaded;

  useEffect(() => {
    let active = true;
    setAccountKeys({ userId, keys: {}, loaded: false });
    void api
      .getUserProviderSettings()
      .then((rows) => {
        if (!active) return;
        const localKeys = loadApiKeysFromStorage(userId);
        const remoteByProvider = new Map(rows.map((row) => [row.providerName, row]));
        const nextKeys: Record<string, string> = {};
        const migratedProviders = new Set<string>();
        const pendingMigrationKeys = new Map<string, string>();

        void (async () => {
          for (const [provider, key] of Object.entries(localKeys)) {
            const remote = remoteByProvider.get(provider);
            try {
              if (remote?.hasKey) {
                removeApiKeyFromStorage(userId, provider);
              } else if (!remote) {
                await api.saveUserProviderSetting({
                  providerName: provider,
                  isEnabled: true,
                  apiKey: key,
                });
                removeApiKeyFromStorage(userId, provider);
                migratedProviders.add(provider);
              }
            } catch {
              // Keep the legacy copy when migration cannot be persisted.
              pendingMigrationKeys.set(provider, key);
              continue;
            }
          }

          if (!active) return;
          for (const row of rows) {
            if (row.isEnabled && row.hasKey) nextKeys[row.providerName] = CORE_STORED_KEY;
          }
          for (const provider of Object.keys(localKeys)) {
            if (!nextKeys[provider] && migratedProviders.has(provider)) {
              nextKeys[provider] = CORE_STORED_KEY;
            }
            if (!nextKeys[provider] && pendingMigrationKeys.has(provider)) {
              nextKeys[provider] = pendingMigrationKeys.get(provider) ?? "";
            }
          }
          setAccountKeys({ userId, keys: nextKeys, loaded: true });
        })();
      })
      .catch(() => {
        if (active) setAccountKeys({ userId, keys: loadApiKeysFromStorage(userId), loaded: true });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const handleKeysCleared = (event: Event) => {
      const clearedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (clearedUserId !== userId) return;
      setAccountKeys({ userId, keys: {}, loaded: true });
    };
    window.addEventListener(API_KEYS_CLEARED_EVENT, handleKeysCleared);
    return () => window.removeEventListener(API_KEYS_CLEARED_EVENT, handleKeysCleared);
  }, [userId]);

  const setKey = useCallback(
    async (provider: string, key: string) => {
      if (!userId) return;
      // Capture the pre-optimistic value so a rejected Core save can restore
      // it instead of leaving the UI reporting "Connected" for a key Core
      // never persisted.
      let previousValue: string | undefined;
      setAccountKeys((previous) => {
        const next = previous.userId === userId ? { ...previous.keys } : {};
        previousValue = next[provider];
        next[provider] = key;
        return { userId, keys: next, loaded: true };
      });
      try {
        await api.saveUserProviderSetting({
          providerName: provider,
          isEnabled: true,
          apiKey: key,
        });
      } catch (err) {
        setAccountKeys((previous) => {
          const next = previous.userId === userId ? { ...previous.keys } : {};
          if (previousValue === undefined) {
            delete next[provider];
          } else {
            next[provider] = previousValue;
          }
          return { userId, keys: next, loaded: true };
        });
        throw err;
      }
      removeApiKeyFromStorage(userId, provider);
      setAccountKeys((previous) => {
        const next = previous.userId === userId ? { ...previous.keys } : {};
        next[provider] = CORE_STORED_KEY;
        return { userId, keys: next, loaded: true };
      });
    },
    [userId],
  );

  const removeKey = useCallback(
    async (provider: string) => {
      if (!userId) return;
      await api.deleteUserProviderSetting(provider);
      removeApiKeyFromStorage(userId, provider);
      setAccountKeys((previous) => {
        const next = previous.userId === userId ? { ...previous.keys } : {};
        delete next[provider];
        return { userId, keys: next, loaded: true };
      });
    },
    [userId],
  );

  const hasKey = useCallback((provider: string) => Boolean(keys[provider]), [keys]);
  const getKey = useCallback((provider: string) => keys[provider] ?? "", [keys]);
  const validateKey = useCallback(
    (provider: string, key: string) =>
      api.validateApiKey(provider, key) as Promise<{ valid: boolean; error?: string }>,
    [],
  );

  return { keys, loaded, hasKey, getKey, setKey, removeKey, validateKey };
}
