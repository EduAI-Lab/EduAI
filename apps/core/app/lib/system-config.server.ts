import prisma from "~/lib/prisma.server";

export const WEB_TOOLS_CONFIG_KEY = "webToolsEnabled";

const CACHE_TTL_MS = 5 * 60 * 1000;

let webToolsCache: { value: boolean; expiresAt: number } | null = null;

export function invalidateWebToolsCache(): void {
  webToolsCache = null;
}

export async function getWebToolsEnabled(): Promise<boolean> {
  if (webToolsCache && Date.now() < webToolsCache.expiresAt) {
    return webToolsCache.value;
  }

  const row = await prisma.systemConfig.findUnique({
    where: { key: WEB_TOOLS_CONFIG_KEY },
  });

  const value = row?.value === "true";
  webToolsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function setWebToolsEnabled(enabled: boolean, updatedBy: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: WEB_TOOLS_CONFIG_KEY },
    create: {
      key: WEB_TOOLS_CONFIG_KEY,
      value: String(enabled),
      description: "When true, webSearch and fetchPage are registered in the chat tool path.",
      updatedBy,
    },
    update: {
      value: String(enabled),
      updatedBy,
    },
  });
  invalidateWebToolsCache();
}
