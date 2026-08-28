import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { encrypt, decrypt } from "~/lib/canvas/encryption";
import type { UserProviderSettings } from "~/lib/ai/provider-types";
import {
  BEDROCK_USER_SETTINGS_ERROR,
  isBedrockProviderName,
} from "~/lib/ai/routing/bedrock/bedrock-settings";

export async function getUserProviderSettings(userId: string): Promise<UserProviderSettings> {
  const rows = await prisma.userProviderSettings.findMany({
    where: { userId },
    select: {
      isEnabled: true,
      apiKey: true,
      baseUrl: true,
      provider: { select: { name: true } },
    },
  });

  const settings: UserProviderSettings = {};
  for (const row of rows) {
    if (isBedrockProviderName(row.provider.name)) continue;
    settings[row.provider.name] = {
      isEnabled: row.isEnabled,
      apiKey: row.apiKey ? decrypt(row.apiKey) : undefined,
      baseUrl: row.baseUrl ?? undefined,
    };
  }
  return settings;
}

export type UpsertProviderInput = {
  isEnabled: boolean;
  apiKey?: string;
  baseUrl?: string;
};

export async function upsertUserProviderSetting(
  userId: string,
  providerName: string,
  input: UpsertProviderInput,
): Promise<void> {
  if (isBedrockProviderName(providerName)) {
    throw new Error(BEDROCK_USER_SETTINGS_ERROR);
  }
  const provider = await prisma.aIProvider.findUnique({ where: { name: providerName } });
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  const encryptedKey =
    input.apiKey !== undefined ? (input.apiKey ? encrypt(input.apiKey) : null) : undefined;

  // A field the caller did not send must not reach the UPDATE at all, so an
  // absent `apiKey` keeps the stored secret rather than clearing it.
  const update: Prisma.UserProviderSettingsUpdateInput = { isEnabled: input.isEnabled };
  if (encryptedKey !== undefined) update.apiKey = encryptedKey;
  if (input.baseUrl !== undefined) update.baseUrl = input.baseUrl || null;

  await prisma.userProviderSettings.upsert({
    where: { userId_providerId: { userId, providerId: provider.id } },
    create: {
      userId,
      providerId: provider.id,
      isEnabled: input.isEnabled,
      apiKey: encryptedKey ?? null,
      baseUrl: input.baseUrl ?? null,
    },
    update,
  });
}

export async function deleteUserProviderSetting(
  userId: string,
  providerName: string,
): Promise<void> {
  if (isBedrockProviderName(providerName)) {
    throw new Error(BEDROCK_USER_SETTINGS_ERROR);
  }
  const provider = await prisma.aIProvider.findUnique({ where: { name: providerName } });
  if (!provider) return;
  await prisma.userProviderSettings.deleteMany({
    where: { userId, providerId: provider.id },
  });
}
