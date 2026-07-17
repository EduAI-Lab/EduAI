/**
 * BYOK (bring-your-own-key) provider-key helpers — the platform-standard
 * pattern (Core keeps user provider keys client-side and forwards them per
 * request; AI Tutor does the same). Keys live only in localStorage; the server
 * never persists them. Centralised here so the chat composer and the Settings →
 * Providers tab share one source of truth.
 */

export type ProviderId = 'google' | 'openai';

/** Providers a student can configure a key for, in display order. */
export const PROVIDERS: ReadonlyArray<{
  id: ProviderId;
  label: string;
  /** Where to get a key. */
  keyUrl: string;
}> = [
  { id: 'google', label: 'Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
];

const PROVIDER_LABELS: Record<string, string> = { google: 'Gemini', openai: 'OpenAI' };

/** localStorage key — unchanged from the original chat implementation so any
 *  keys a student already saved keep working after this refactor. */
export const API_KEYS_STORAGE_KEY = 'ai-provider-keys';

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** The provider half of a namespaced model id ("google:gemini-2.5-flash"). */
export function getProviderFromModelId(modelId: string): string {
  return modelId.split(':')[0] || 'google';
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `••••••${key.slice(-4)}`;
}

// Read/write are wrapped to survive SSR-like envs and quota errors silently.
export function loadApiKeysFromStorage(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(API_KEYS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveApiKeysToStorage(keys: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Ignore storage errors
  }
}
