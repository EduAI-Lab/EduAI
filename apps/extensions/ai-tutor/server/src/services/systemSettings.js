import { prisma } from "../config/database.js";
import { decrypt, encrypt, hasEncryptionKey } from "../utils/encryption.js";

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
 * Encrypt a secret setting value before persisting. Falls back to plaintext
 * (with a warning) when no ENCRYPTION_KEY is configured, so a deployment that
 * has not set the env var keeps working — existing plaintext rows also remain
 * readable via `decrypt`'s legacy passthrough.
 */
function encodeSettingValue(key, value) {
  if (!ENCRYPTED_SETTING_KEYS.has(key)) return value;
  if (!value) return value;
  if (!hasEncryptionKey()) {
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
    return readSecretValue(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, override.value);
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
