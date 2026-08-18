import prisma from "~/lib/prisma.server";
import {
  BEDROCK_OVERFLOW_SETTING_DEFINITIONS,
  BEDROCK_OVERFLOW_SETTING_KEYS,
  BEDROCK_OVERFLOW_SETTING_PREFIX,
  defaultBedrockOverflowSettings,
  isBedrockOverflowSettingKey,
  parseBedrockLimit,
  type BedrockOverflowSettingKey,
  type BedrockOverflowSettings,
} from "./bedrock-settings";

const CACHE_TTL_MS = 10 * 1000;

let cache: { value: BedrockOverflowSettings; expiresAt: number } | null = null;

export function invalidateBedrockOverflowSettingsCache(): void {
  cache = null;
}

function applyRow(
  settings: BedrockOverflowSettings,
  key: string,
  value: string,
): void {
  const settingKey = key.startsWith(BEDROCK_OVERFLOW_SETTING_PREFIX)
    ? key.slice(BEDROCK_OVERFLOW_SETTING_PREFIX.length)
    : key;
  if (!isBedrockOverflowSettingKey(settingKey)) return;
  if (settingKey === "enabled") {
    settings.enabled = value === "true";
    return;
  }
  settings[settingKey] = parseBedrockLimit(value, 0);
}

export async function getBedrockOverflowSettings(): Promise<BedrockOverflowSettings> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  const keys = BEDROCK_OVERFLOW_SETTING_KEYS.map(
    (key) => BEDROCK_OVERFLOW_SETTING_PREFIX + key,
  );
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const value = defaultBedrockOverflowSettings();
  for (const row of rows) {
    applyRow(value, row.key, row.value);
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function setBedrockOverflowSettings(
  settings: BedrockOverflowSettings,
  updatedBy: string,
): Promise<BedrockOverflowSettings> {
  for (const key of BEDROCK_OVERFLOW_SETTING_KEYS) {
    await upsertBedrockOverflowSetting(key, settings[key], updatedBy);
  }
  invalidateBedrockOverflowSettingsCache();
  return getBedrockOverflowSettings();
}

async function upsertBedrockOverflowSetting(
  key: BedrockOverflowSettingKey,
  value: boolean | number,
  updatedBy: string,
): Promise<void> {
  const definition = BEDROCK_OVERFLOW_SETTING_DEFINITIONS[key];
  await prisma.systemConfig.upsert({
    where: { key: BEDROCK_OVERFLOW_SETTING_PREFIX + key },
    create: {
      key: BEDROCK_OVERFLOW_SETTING_PREFIX + key,
      value: String(value),
      description: definition.description,
      updatedBy,
    },
    update: {
      value: String(value),
      updatedBy,
    },
  });
}
