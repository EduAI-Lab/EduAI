import { useCallback, useEffect, useState } from 'react';
import api from '~/lib/api';
import { loadApiKeysFromStorage, saveApiKeysToStorage } from '~/lib/provider-keys';

export type UseApiKeysResult = {
  /** provider id → key. */
  keys: Record<string, string>;
  /** false until localStorage has been read (post-hydration). */
  loaded: boolean;
  hasKey: (provider: string) => boolean;
  getKey: (provider: string) => string;
  setKey: (provider: string, key: string) => void;
  removeKey: (provider: string) => void;
  validateKey: (provider: string, key: string) => Promise<{ valid: boolean; error?: string }>;
};

/**
 * Owns the student's BYOK provider keys (localStorage-backed). Consumed by both
 * the chat composer's quick-add and the Settings → Providers tab, so key entry
 * is the same everywhere — mirroring Core's `use-api-keys` + `ApiKeySettings`.
 */
export function useApiKeys(): UseApiKeysResult {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setKeys(loadApiKeysFromStorage());
    setLoaded(true);
  }, []);

  const setKey = useCallback((provider: string, key: string) => {
    setKeys((prev) => {
      const next = { ...prev, [provider]: key };
      saveApiKeysToStorage(next);
      return next;
    });
  }, []);

  const removeKey = useCallback((provider: string) => {
    setKeys((prev) => {
      const next = { ...prev };
      delete next[provider];
      saveApiKeysToStorage(next);
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
