import { prisma } from '../config/database.js';

export const SYSTEM_SETTING_KEYS = {
  EDUAI_API_KEY: 'EDUAI_API_KEY',
  AI_MODEL_POLICY: 'AI_MODEL_POLICY',
};

export async function getSystemSetting(key) {
  if (!key) return null;
  return prisma.systemSetting.findUnique({ where: { key } });
}

export async function setSystemSetting(key, value) {
  if (!key) throw new Error('System setting key is required');
  if (typeof value !== 'string') throw new Error('System setting value must be a string');
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function clearSystemSetting(key) {
  if (!key) return;
  await prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
}

export async function getEffectiveEduAiApiKey() {
  const override = await getSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY);
  if (override?.value) return override.value;
  return process.env.EDUAI_API_KEY || null;
}

export async function getEduAiApiKeyStatus() {
  const override = await getSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY);
  const envKey = process.env.EDUAI_API_KEY || null;

  const configured = Boolean(override?.value || envKey);
  const source = override?.value ? 'ADMIN' : envKey ? 'ENV' : 'NONE';

  return {
    configured,
    source,
    hasAdminOverride: Boolean(override?.value),
    envConfigured: Boolean(envKey),
    updatedAt: override?.updatedAt ? override.updatedAt.toISOString() : null,
  };
}
