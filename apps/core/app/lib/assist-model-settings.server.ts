import prisma from "~/lib/prisma.server";

const ASSIST_MODEL_KEY = "routing.assistModelId";
const ASSIST_MODEL_DESCRIPTION =
  "Concrete provider:modelId used for Assistive mode when configured; null uses the selected chat model.";
const CACHE_TTL_MS = 10 * 1000;

let cache: { value: string | null; expiresAt: number } | null = null;

export async function getAssistModelId(): Promise<string | null> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const row = await prisma.systemConfig.findUnique({
    where: { key: ASSIST_MODEL_KEY },
    select: { value: true },
  });
  const value = row?.value?.trim() || null;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function setAssistModelId(modelId: string | null, updatedBy: string): Promise<void> {
  if (modelId === null) {
    await prisma.systemConfig.deleteMany({ where: { key: ASSIST_MODEL_KEY } });
  } else {
    await prisma.systemConfig.upsert({
      where: { key: ASSIST_MODEL_KEY },
      create: {
        key: ASSIST_MODEL_KEY,
        value: modelId,
        description: ASSIST_MODEL_DESCRIPTION,
        updatedBy,
      },
      update: { value: modelId, updatedBy },
    });
  }
  cache = { value: modelId, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function invalidateAssistModelCache(): void {
  cache = null;
}
