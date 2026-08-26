import { useCallback, useEffect, useState } from 'react';
import api from '~/lib/api';
import {
  CORE_STORED_KEY,
  loadApiKeysFromStorage,
  saveApiKeysToStorage,
} from '~/lib/provider-keys';

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
 * Owns the student's BYOK provider-key status through Core. Raw keys are sent
 * to Core only on save and are never returned to the browser by a status read.
 */
export function useApiKeys(): UseApiKeysResult {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await api.getUserProviderSettings();
        const next = Object.fromEntries(
          rows
            .filter((row) => row.isEnabled && row.hasKey)
            .map((row) => [row.providerName, CORE_STORED_KEY]),
        );
        if (active) {
          setKeys(next);
          setLoaded(true);
        }

        // One-time bridge for keys saved by older AI Tutor builds. Delete the
        // browser copy only after Core confirms the encrypted write.
        const legacy = loadApiKeysFromStorage();
        const remainingLegacy = { ...legacy };
        const migratedProviders = new Set<string>();
        for (const [provider, key] of Object.entries(legacy)) {
          if (!key || next[provider]) continue;
          try {
            await api.saveUserProviderSetting({ providerName: provider, isEnabled: true, apiKey: key });
            delete remainingLegacy[provider];
            migratedProviders.add(provider);
          } catch {
            // Keep this provider's legacy key if its Core write is temporarily unavailable.
          }
        }
        if (Object.keys(remainingLegacy).length !== Object.keys(legacy).length) {
          saveApiKeysToStorage(remainingLegacy);
          if (active) {
            const migrated = { ...next };
            for (const provider of migratedProviders) migrated[provider] = CORE_STORED_KEY;
            // Keep failed migrations usable in the degraded local fallback
            // until Core is reachable and accepts the next migration attempt.
            Object.assign(migrated, remainingLegacy);
            setKeys(migrated);
          }
        }
      } catch {
        if (active) {
          setKeys(loadApiKeysFromStorage());
          setLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setKey = useCallback(async (provider: string, key: string) => {
    await api.saveUserProviderSetting({ providerName: provider, isEnabled: true, apiKey: key });
    setKeys((prev) => ({ ...prev, [provider]: CORE_STORED_KEY }));
  }, []);

  const removeKey = useCallback(async (provider: string) => {
    await api.deleteUserProviderSetting(provider);
    setKeys((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
  }, []);

  const hasKey = useCallback((provider: string) => Boolean(keys[provider]), [keys]);
  const getKey = useCallback((provider: string) => keys[provider] ?? '', [keys]);
  const validateKey = useCallback(
    (provider: string, key: string) =>
      api.validateApiKey(provider, key) as Promise<{ valid: boolean; error?: string }>,
    [],
  );

  return { keys, loaded, hasKey, getKey, setKey, removeKey, validateKey };
}
