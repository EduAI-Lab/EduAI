/**
 * Account-bound browser storage for AI provider API keys.
 *
 * AES-GCM prevents the values from being left as plaintext in localStorage, but
 * its derivation material lives on the same origin and is not an XSS boundary.
 * The security boundary here is the authenticated-user namespace plus clearing
 * that namespace on logout; no API may fall back to another user's entries.
 */

const LEGACY_STORAGE_KEY_PREFIX = "eduai_api_key_";
const LEGACY_ENCRYPTION_KEY_NAME = "eduai_encryption_key";
const STORAGE_KEY_PREFIX = "eduai_api_key_v2:";
const ENCRYPTION_KEY_PREFIX = "eduai_encryption_key_v2:";

export type AIProvider = "google" | "openai" | "deepseek" | "anthropic" | "opencode";

/**
 * One provider's credential as the AI service reads it. The key is absent for a
 * campus-hosted provider, which is enabled without one.
 */
export type ProviderApiKey = { apiKey?: string; isEnabled: boolean };

/**
 * The `apiKeys` payload every generation request carries, keyed by provider id.
 * Keyed by `string` rather than `AIProvider` because a campus provider id also
 * appears here, and the backend accepts any provider it knows about.
 */
export type ProviderApiKeys = Record<string, ProviderApiKey>;

/** UBC-hosted campus providers (no client API key). `ollama` kept for legacy responses. */
export type CampusProvider = "vllm" | "ollama";

/** Cloud (key-bearing) providers, as opposed to the UBC-hosted campus path. */
export const CLOUD_PROVIDERS: AIProvider[] = [
  "google",
  "openai",
  "deepseek",
  "anthropic",
  "opencode",
];

type AccountScope = {
  userId: string;
  revision: number;
};

let authenticatedUserId: string | null = null;
let scopeRevision = 0;

const normalizeUserId = (userId: string | null | undefined): string | null => {
  const normalized = userId?.trim();
  return normalized ? normalized : null;
};

const storageKeyFor = (userId: string, provider: AIProvider): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}:${provider}`;

const encryptionKeyNameFor = (userId: string): string =>
  `${ENCRYPTION_KEY_PREFIX}${encodeURIComponent(userId)}`;

const currentScope = (): AccountScope | null =>
  authenticatedUserId ? { userId: authenticatedUserId, revision: scopeRevision } : null;

const isCurrentScope = (scope: AccountScope): boolean =>
  authenticatedUserId === scope.userId && scopeRevision === scope.revision;

const removeStorageKeysWithPrefix = (prefix: string, keepPrefix?: string): void => {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix) && (!keepPrefix || !key.startsWith(keepPrefix))) {
      localStorage.removeItem(key);
    }
  }
};

const discardLegacyUnscopedEntries = (): void => {
  try {
    removeStorageKeysWithPrefix(LEGACY_STORAGE_KEY_PREFIX, STORAGE_KEY_PREFIX);
    localStorage.removeItem(LEGACY_ENCRYPTION_KEY_NAME);
  } catch {
    // Storage may be disabled. Never treat that as permission to use a fallback namespace.
  }
};

/** True when a provider id names a cloud provider (any supported one — not just Google). */
export function isCloudProvider(provider: string | null | undefined): provider is AIProvider {
  return !!provider && (CLOUD_PROVIDERS as string[]).includes(provider);
}

/** True when a provider id names the UBC-hosted campus path (`vllm` or legacy `ollama`). */
export function isCampusProvider(provider: string | null | undefined): provider is CampusProvider {
  return provider === "vllm" || provider === "ollama";
}

/** Generates or retrieves an account-scoped AES-GCM key derivation salt. */
async function getEncryptionKey(userId: string): Promise<CryptoKey> {
  const keyName = encryptionKeyNameFor(userId);
  let salt = localStorage.getItem(keyName);

  if (!salt) {
    const saltArray = crypto.getRandomValues(new Uint8Array(16));
    salt = Array.from(saltArray, (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(keyName, salt);
  }

  // Create a key from the salt using PBKDF2
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(salt), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("eduai-storage-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts a plaintext string into base64 with IV prepended. */
async function encrypt(value: string, userId: string): Promise<string> {
  const key = await getEncryptionKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64 payload produced by `encrypt`, returning plaintext or empty string on failure. */
async function decrypt(encryptedValue: string, userId: string): Promise<string> {
  try {
    const key = await getEncryptionKey(userId);
    const decoder = new TextDecoder();

    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);

    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
}

const getApiKeyForUser = async (userId: string, provider: AIProvider): Promise<string | null> => {
  const encrypted = localStorage.getItem(storageKeyFor(userId, provider));
  if (!encrypted) return null;
  const value = await decrypt(encrypted, userId);
  return value || null;
};

export const apiKeyStorage = {
  /** Binds all subsequent reads and writes to one authenticated account. */
  setAuthenticatedUser(userId: string | null): void {
    const nextUserId = normalizeUserId(userId);
    if (nextUserId !== authenticatedUserId) {
      authenticatedUserId = nextUserId;
      scopeRevision += 1;
    }
    discardLegacyUnscopedEntries();
  },

  /** Removes every key and derivation salt belonging to one account. */
  clearApiKeysForUser(userId: string | null | undefined): void {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return;
    try {
      removeStorageKeysWithPrefix(`${STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}:`);
      localStorage.removeItem(encryptionKeyNameFor(normalizedUserId));
    } catch {
      // Continue logout even when browser storage is unavailable.
    }
    if (authenticatedUserId === normalizedUserId) scopeRevision += 1;
  },

  /** Stores an API key for the bound account after encrypting it. */
  async setApiKey(provider: AIProvider, apiKey: string): Promise<void> {
    const scope = currentScope();
    if (!scope) throw new Error("Cannot store an API key without an authenticated user");
    const encrypted = await encrypt(apiKey, scope.userId);
    if (!isCurrentScope(scope)) return;
    localStorage.setItem(storageKeyFor(scope.userId, provider), encrypted);
  },

  /** Retrieves a key only from the currently bound account. */
  async getApiKey(provider: AIProvider): Promise<string | null> {
    const scope = currentScope();
    if (!scope) return null;
    const value = await getApiKeyForUser(scope.userId, provider);
    return isCurrentScope(scope) ? value : null;
  },

  /** Removes a key only from the currently bound account. */
  removeApiKey(provider: AIProvider): void {
    const scope = currentScope();
    if (!scope) return;
    localStorage.removeItem(storageKeyFor(scope.userId, provider));
  },

  /** Returns provider keys only from one stable account-scope snapshot. */
  async getAllApiKeys(): Promise<Record<string, string>> {
    const scope = currentScope();
    if (!scope) return {};
    const keys: Record<string, string> = {};

    for (const provider of CLOUD_PROVIDERS) {
      const key = await getApiKeyForUser(scope.userId, provider);
      if (!isCurrentScope(scope)) return {};
      if (key) {
        keys[provider] = key;
      }
    }

    return keys;
  },

  /** Derives provider name from a model ID prefix (e.g., google:gemini → google). */
  getProviderFromModel(modelId: string): AIProvider | null {
    const provider = modelId.split(":")[0].toLowerCase();
    if (isCloudProvider(provider)) {
      return provider;
    }
    return null;
  },

  /** Returns true when the selected model requires a provider API key (cloud only). */
  requiresApiKey(modelId: string): boolean {
    return !modelId.startsWith("ollama") && !modelId.startsWith("vllm");
  },

  /** Builds the apiKeys payload expected by the AI service based on the chosen model and stored keys. */
  async buildApiKeysForModel(modelId: string): Promise<ProviderApiKeys> {
    if (modelId.startsWith("ollama")) {
      return {
        ollama: {
          isEnabled: true,
        },
      };
    }
    if (modelId.startsWith("vllm")) {
      return {
        vllm: {
          isEnabled: true,
        },
      };
    }

    const provider = this.getProviderFromModel(modelId);
    if (!provider) {
      return {};
    }

    const scope = currentScope();
    if (!scope) return {};
    const apiKey = await getApiKeyForUser(scope.userId, provider);
    if (!isCurrentScope(scope) || !apiKey) {
      return {};
    }

    return {
      [provider]: {
        apiKey,
        isEnabled: true,
      },
    };
  },
};

export default apiKeyStorage;
