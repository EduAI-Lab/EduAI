import prisma from "~/lib/prisma.server";
import {
  ASSISTANT_SETTING_DEFINITIONS,
  ASSISTANT_SETTING_STORAGE_KEYS,
  clampMaxDocs,
  normalizeModelSetting,
  parseAssistantSettings,
  type AssistantSettingKey,
  type AssistantSettings,
} from "~/lib/assistant/assistant-settings";

const CACHE_TTL_MS = 10 * 1000;

let cache: { value: AssistantSettings; expiresAt: number } | null = null;

export function invalidateAssistantSettingsCache(): void {
  cache = null;
}

/** Code defaults overlaid with stored values; cached briefly like the other admin settings. */
export async function getAssistantSettings(): Promise<AssistantSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: Object.values(ASSISTANT_SETTING_STORAGE_KEYS) } },
    select: { key: true, value: true },
  });
  const value = parseAssistantSettings(new Map(rows.map((row) => [row.key, row.value])));
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Every patched setting as its stored text, typed per key rather than per value. */
function serializePatch(patch: Partial<AssistantSettings>): Array<[AssistantSettingKey, string]> {
  const out: Array<[AssistantSettingKey, string]> = [];
  if (patch.enableHelpAssistant !== undefined) {
    out.push(["enableHelpAssistant", String(patch.enableHelpAssistant)]);
  }
  if (patch.enableStudentMaterialQuestions !== undefined) {
    out.push(["enableStudentMaterialQuestions", String(patch.enableStudentMaterialQuestions)]);
  }
  if (patch.maxDocs !== undefined) out.push(["maxDocs", String(clampMaxDocs(patch.maxDocs))]);
  if (patch.routerModel !== undefined) {
    out.push(["routerModel", normalizeModelSetting(patch.routerModel)]);
  }
  if (patch.defaultModel !== undefined) {
    out.push(["defaultModel", normalizeModelSetting(patch.defaultModel)]);
  }
  return out;
}

/**
 * Persist the settings an admin sent. Callers must have re-checked the ADMIN role
 * for this write themselves — this module trusts its caller, as every other
 * settings writer here does.
 */
export async function updateAssistantSettings(
  patch: Partial<AssistantSettings>,
  updatedBy: string,
): Promise<AssistantSettings> {
  await prisma.$transaction(
    serializePatch(patch).map(([key, stored]) => {
      const storageKey = ASSISTANT_SETTING_STORAGE_KEYS[key];
      return prisma.systemConfig.upsert({
        where: { key: storageKey },
        create: {
          key: storageKey,
          value: stored,
          description: ASSISTANT_SETTING_DEFINITIONS[key].description,
          updatedBy,
        },
        update: { value: stored, updatedBy },
      });
    }),
  );
  invalidateAssistantSettingsCache();
  return getAssistantSettings();
}
