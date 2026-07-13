/**
 * Browser-side storage helper for encrypting/decrypting AI provider API keys in localStorage.
 * Uses Web Crypto AES-GCM with a derived key so keys stay encrypted at rest in the browser.
 */

const STORAGE_KEY_PREFIX = 'eduai_api_key_';
const ENCRYPTION_KEY_NAME = 'eduai_encryption_key';

export type AIProvider = 'google' | 'openai' | 'deepseek' | 'anthropic';

/** UBC-hosted campus providers (no client API key). `ollama` kept for legacy responses. */
export type CampusProvider = 'vllm' | 'ollama';

/** Cloud (key-bearing) providers, as opposed to the UBC-hosted campus path. */
export const CLOUD_PROVIDERS: AIProvider[] = ['google', 'openai', 'deepseek', 'anthropic'];

/** True when a provider id names a cloud provider (any supported one — not just Google). */
export function isCloudProvider(provider: string | null | undefined): provider is AIProvider {
  return !!provider && (CLOUD_PROVIDERS as string[]).includes(provider);
}

/** True when a provider id names the UBC-hosted campus path (`vllm` or legacy `ollama`). */
export function isCampusProvider(provider: string | null | undefined): provider is CampusProvider {
  return provider === 'vllm' || provider === 'ollama';
}

/** Generates or retrieves a derived AES-GCM key for encrypting provider secrets in this browser. */
async function getEncryptionKey(): Promise<CryptoKey> {
  // Try to get existing salt from localStorage
  let salt = localStorage.getItem(ENCRYPTION_KEY_NAME);

  if (!salt) {
    // Generate new salt and store it
    const saltArray = crypto.getRandomValues(new Uint8Array(16));
    salt = Array.from(saltArray, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(ENCRYPTION_KEY_NAME, salt);
  }

  // Create a key from the salt using PBKDF2
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('eduai-storage-salt'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypts a plaintext string into base64 with IV prepended. */
async function encrypt(value: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value)
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64 payload produced by `encrypt`, returning plaintext or empty string on failure. */
async function decrypt(encryptedValue: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const decoder = new TextDecoder();

    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedValue), c => c.charCodeAt(0));

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return '';
  }
}

export const apiKeyStorage = {
  /** Stores an API key for a provider after encrypting it. */
  async setApiKey(provider: AIProvider, apiKey: string): Promise<void> {
    const encrypted = await encrypt(apiKey);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${provider}`, encrypted);
  },

  /** Retrieves and decrypts a stored API key for a provider. */
  async getApiKey(provider: AIProvider): Promise<string | null> {
    const encrypted = localStorage.getItem(`${STORAGE_KEY_PREFIX}${provider}`);
    if (!encrypted) return null;
    return await decrypt(encrypted);
  },

  /** Removes a stored API key entry for a provider. */
  removeApiKey(provider: AIProvider): void {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${provider}`);
  },

  /** Returns all stored provider keys as a decrypted object. */
  async getAllApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};

    for (const provider of CLOUD_PROVIDERS) {
      const key = await this.getApiKey(provider);
      if (key) {
        keys[provider] = key;
      }
    }

    return keys;
  },

  /** Derives provider name from a model ID prefix (e.g., google:gemini → google). */
  getProviderFromModel(modelId: string): AIProvider | null {
    const provider = modelId.split(':')[0].toLowerCase();
    if (isCloudProvider(provider)) {
      return provider;
    }
    return null;
  },

  /** Returns true when the selected model requires a provider API key (cloud only). */
  requiresApiKey(modelId: string): boolean {
    return !modelId.startsWith('ollama') && !modelId.startsWith('vllm');
  },

  /** Builds the apiKeys payload expected by the AI service based on the chosen model and stored keys. */
  async buildApiKeysForModel(modelId: string): Promise<Record<string, any>> {
    if (modelId.startsWith('ollama')) {
      return {
        ollama: {
          isEnabled: true
        }
      };
    }
    if (modelId.startsWith('vllm')) {
      return {
        vllm: {
          isEnabled: true
        }
      };
    }

    const provider = this.getProviderFromModel(modelId);
    if (!provider) {
      return {};
    }

    const apiKey = await this.getApiKey(provider);
    if (!apiKey) {
      return {};
    }

    return {
      [provider]: {
        apiKey,
        isEnabled: true
      }
    };
  }
};

export default apiKeyStorage;
