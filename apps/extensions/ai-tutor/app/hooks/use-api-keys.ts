import { useCallback, useEffect, useState } from 'react';
import { useLocalUser } from '~/hooks/useLocalUser';
import api from '~/lib/api';
import {
  API_KEYS_CLEARED_EVENT,
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
    setAccountKeys({ userId, keys: loadApiKeysFromStorage(userId), loaded: true });
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
    (provider: string, key: string) => {
      if (!userId) return;
      setAccountKeys((previous) => {
        const previousKeys = previous.userId === userId ? previous.keys : {};
        const next = { ...previousKeys, [provider]: key };
        saveApiKeysToStorage(userId, next);
        return { userId, keys: next, loaded: true };
      });
    },
    [userId],
  );

  const removeKey = useCallback(
    (provider: string) => {
      if (!userId) return;
      setAccountKeys((previous) => {
        const next = { ...(previous.userId === userId ? previous.keys : {}) };
        delete next[provider];
        saveApiKeysToStorage(userId, next);
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
