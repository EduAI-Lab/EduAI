import prisma from "~/lib/prisma.server";
import {
  ROUTING_MODEL_SETTING_DEFINITIONS,
  defaultRoutingModelSettings,
  isRoutingModelSettingKey,
  type RoutingModelSettingKey,
  type RoutingModelSettings,
} from "~/lib/routing-model-settings";

const KEY_PREFIX = "routing.model.";
const CACHE_TTL_MS = 10 * 1000;

let cache: { value: RoutingModelSettings; expiresAt: number } | null = null;

export function invalidateRoutingModelSettingsCache(): void {
  cache = null;
}

export async function getRoutingModelSettings(): Promise<RoutingModelSettings> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  const keys = Object.keys(
    ROUTING_MODEL_SETTING_DEFINITIONS,
  ) as RoutingModelSettingKey[];
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys.map((key) => KEY_PREFIX + key) } },
    select: { key: true, value: true },
  });

  const value = defaultRoutingModelSettings();
  for (const row of rows) {
    const key = row.key.slice(KEY_PREFIX.length);
    if (isRoutingModelSettingKey(key)) {
      value[key] = row.value === "true";
    }
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function setRoutingModelSetting(
  key: RoutingModelSettingKey,
  value: boolean,
  updatedBy: string,
): Promise<void> {
  const definition = ROUTING_MODEL_SETTING_DEFINITIONS[key];
  await prisma.systemConfig.upsert({
    where: { key: KEY_PREFIX + key },
    create: {
      key: KEY_PREFIX + key,
      value: String(value),
      description: definition.description,
      updatedBy,
    },
    update: {
      value: String(value),
      updatedBy,
    },
  });
  invalidateRoutingModelSettingsCache();
}
