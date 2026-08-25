/**
 * BYOK (bring-your-own-key) provider-key helpers. AI Tutor keeps these keys in
 * an account-scoped browser namespace and forwards them through EduAI services
 * for model requests. Keys are removed on logout. Centralised here so the chat
 * composer and Settings → Providers share one source of truth.
 */

export type ProviderId = "google" | "openai" | "opencode";

/** Providers a student can configure a key for, in display order. */
export const PROVIDERS: ReadonlyArray<{
  id: ProviderId;
  label: string;
  /** Where to get a key. */
  keyUrl: string;
  /** Provider-specific setup requirement shown beside the key field. */
  note?: string;
}> = [
  { id: "google", label: "Gemini", keyUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys" },
  {
    id: "opencode",
    label: "OpenCode Go",
    keyUrl: "https://opencode.ai/docs/go/",
    note: "Requires an OpenCode Go subscription.",
  },
];

// A `Map` because the provider half of a model id is free-form: an id from a
// provider this build has never heard of labels itself.
const PROVIDER_LABELS = new Map<string, string>([
  ["google", "Gemini"],
  ["openai", "OpenAI"],
  ["opencode", "OpenCode Go"],
]);

/**
 * Providers that need the student's own (BYOK) key to serve a request. Every
 * provider a student can configure a key for (see `PROVIDERS`) is BYOK; UBC-
 * hosted providers (`vllm`, `ollama`) are backed by the server's own key and
 * never require one from the browser. Kept as a set so the composer gate can
 * ask "does the SELECTED model need my key?" instead of "do I hold any key?"
 * (#1645 — a personal key must be a fallback, not a precondition).
 */
const BYOK_PROVIDER_IDS = new Set<string>(PROVIDERS.map((provider) => provider.id));

/**
 * Whether the given provider requires a browser-local BYOK key. UBC-hosted
 * inference (anything not in `BYOK_PROVIDER_IDS`, e.g. `vllm`/`ollama`) is
 * served with the server's key, so those models are usable with no key.
 */
export function providerRequiresByokKey(provider: string): boolean {
  return BYOK_PROVIDER_IDS.has(provider);
}

/**
 * Curated BYOK model catalogue, surfaced in the model picker when the student
 * holds a key for that provider (#1645 facet 2). The server catalogue only
 * lists admin-allowed EduAI/vLLM models, so without this a valid BYOK key can
 * never unlock chat. Kept intentionally small — the models each provider is
 * most likely to serve — and merged after the server catalogue, deduped by
 * model id, so an admin-allowed entry always wins.
 */
export const BYOK_PROVIDER_MODELS: ReadonlyArray<{
  modelId: string;
  modelName: string;
  provider: ProviderId;
}> = [
  { modelId: "google:gemini-2.5-flash", modelName: "Gemini 2.5 Flash", provider: "google" },
  { modelId: "google:gemini-2.5-pro", modelName: "Gemini 2.5 Pro", provider: "google" },
  { modelId: "openai:gpt-4o-mini", modelName: "GPT-4o mini", provider: "openai" },
  { modelId: "openai:gpt-4o", modelName: "GPT-4o", provider: "openai" },
  { modelId: "opencode:deepseek-v4-flash", modelName: "DeepSeek V4 Flash", provider: "opencode" },
];

/** BYOK models a student can pick given the provider keys they currently hold. */
export function byokModelsForHeldKeys(
  heldProviders: ReadonlyArray<string> | ReadonlySet<string>,
): Array<{ modelId: string; modelName: string; provider: ProviderId }> {
  const held = heldProviders instanceof Set ? heldProviders : new Set(heldProviders);
  return BYOK_PROVIDER_MODELS.filter((model) => held.has(model.provider)).map((model) => ({
    ...model,
  }));
}

/** Legacy unscoped localStorage key. It is deliberately discarded because its
 * owner cannot be established safely on a shared browser. */
export const API_KEYS_STORAGE_KEY = "ai-provider-keys";
const API_KEYS_STORAGE_PREFIX = `${API_KEYS_STORAGE_KEY}:v2:`;
export const API_KEYS_CLEARED_EVENT = "eduai:provider-keys-cleared";

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS.get(provider) ?? provider;
}

/** The provider half of a namespaced model id ("google:gemini-2.5-flash"). */
export function getProviderFromModelId(modelId: string): string {
  return modelId.split(":")[0] || "google";
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `••••••${key.slice(-4)}`;
}

export function getApiKeysStorageKey(userId: string): string {
  return `${API_KEYS_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

/** Removes keys saved before account-bound storage existed. The old entry has
 * no trustworthy owner, so migrating it to whichever user signs in next would
 * recreate the cross-account disclosure this boundary prevents. */
export function discardLegacyApiKeysFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(API_KEYS_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/** Read/write helpers are wrapped to survive SSR-like environments and browser
 * storage failures without ever falling back to another account's namespace. */
export function loadApiKeysFromStorage(userId: string | null | undefined): Record<string, string> {
  if (typeof window === "undefined" || !userId) return {};
  try {
    discardLegacyApiKeysFromStorage();
    const stored = localStorage.getItem(getApiKeysStorageKey(userId));
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function saveApiKeysToStorage(
  userId: string | null | undefined,
  keys: Record<string, string>,
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    discardLegacyApiKeysFromStorage();
    const storageKey = getApiKeysStorageKey(userId);
    if (Object.keys(keys).length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(keys));
    }
  } catch {
    // Ignore storage errors.
  }
}

export function clearApiKeysForUser(userId: string | null | undefined): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.removeItem(getApiKeysStorageKey(userId));
  } catch {
    // Ignore storage errors.
  }
  window.dispatchEvent(new CustomEvent(API_KEYS_CLEARED_EVENT, { detail: { userId } }));
}
