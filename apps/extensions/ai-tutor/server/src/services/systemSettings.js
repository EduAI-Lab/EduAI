import { prisma } from "../config/database.js";
import {
  decrypt,
  encrypt,
  hasEncryptionKey,
  SecretEncryptionUnavailableError,
} from "../utils/encryption.js";

export const SYSTEM_SETTING_KEYS = {
  EDUAI_API_KEY: "EDUAI_API_KEY",
  AI_MODEL_POLICY: "AI_MODEL_POLICY",
};

/**
 * Secret-valued setting keys that are encrypted at rest (#1571). Their value is
 * an AES-256-GCM blob in the DB; read it back through `readSecretValue`.
 * Non-secret keys (e.g. AI_MODEL_POLICY JSON) are stored/read verbatim.
 */
const ENCRYPTED_SETTING_KEYS = new Set([SYSTEM_SETTING_KEYS.EDUAI_API_KEY]);

/**
 * Encrypt a secret setting value before persisting. When no ENCRYPTION_KEY is
 * configured the behavior is environment-dependent (#1571 / review follow-up):
 *   - production fails closed — it refuses to persist the secret in plaintext
 *     at rest and throws `SecretEncryptionUnavailableError`;
 *   - development/test fall back to plaintext (with a warning) so a deployment
 *     without the env var keeps working locally.
 * Existing plaintext rows always remain readable via `decrypt`'s legacy
 * passthrough regardless of environment, so migration is non-breaking.
 */
function encodeSettingValue(key, value) {
  if (!ENCRYPTED_SETTING_KEYS.has(key)) return value;
  if (!value) return value;
  if (!hasEncryptionKey()) {
    if (process.env.NODE_ENV === "production") {
      throw new SecretEncryptionUnavailableError(
        `Refusing to store ${key} at rest without ENCRYPTION_KEY. Set ENCRYPTION_KEY to enable encrypted secret storage.`,
      );
    }
    console.warn(
      `[systemSettings] ENCRYPTION_KEY not set — storing ${key} in PLAINTEXT. Set ENCRYPTION_KEY to encrypt it at rest.`,
    );
    return value;
  }
  return encrypt(value);
}

/** Decrypt a secret setting value read from the DB (legacy plaintext passes through). */
function readSecretValue(key, value) {
  if (!ENCRYPTED_SETTING_KEYS.has(key) || !value) return value;
  return decrypt(value);
}

export async function getSystemSetting(key) {
  if (!key) return null;
  return prisma.systemSetting.findUnique({ where: { key } });
}

export async function setSystemSetting(key, value) {
  if (!key) throw new Error("System setting key is required");
  if (typeof value !== "string") throw new Error("System setting value must be a string");
  const stored = encodeSettingValue(key, value);
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  });
}

export async function clearSystemSetting(key) {
  if (!key) return;
  await prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
}

export async function getEffectiveEduAiApiKey() {
  const override = await getSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY);
  if (override?.value) {
    try {
      return readSecretValue(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, override.value);
    } catch (error) {
      // The stored override can't be decrypted (ENCRYPTION_KEY missing/rotated,
      // or a corrupted blob). Degrade to the env key rather than 500-ing every
      // eduai request that needs the key.
      console.warn(
        "[systemSettings] Failed to decrypt EDUAI_API_KEY override; falling back to env key.",
        error?.message ?? error,
      );
      return process.env.EDUAI_API_KEY || null;
    }
  }
  return process.env.EDUAI_API_KEY || null;
}

export async function getEduAiApiKeyStatus() {
  const override = await getSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY);
  const envKey = process.env.EDUAI_API_KEY || null;

  const configured = Boolean(override?.value || envKey);
  const source = override?.value ? "ADMIN" : envKey ? "ENV" : "NONE";

  return {
    configured,
    source,
    hasAdminOverride: Boolean(override?.value),
    envConfigured: Boolean(envKey),
    updatedAt: override?.updatedAt ? override.updatedAt.toISOString() : null,
  };
}
