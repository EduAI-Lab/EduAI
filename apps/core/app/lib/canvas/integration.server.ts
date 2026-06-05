import type { CanvasIntegration } from "@prisma/client";
import { UserRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { decrypt, encrypt, isEncrypted } from "~/lib/canvas/encryption";
import type { CanvasIntegrationPublic, ConnectCanvasInput } from "~/lib/canvas/schemas";
import { verifyCanvasCredentials } from "~/lib/canvas/client.server";

const TEST_MODE_API_KEY_PLACEHOLDER = "test-key";

export function canManageCanvasIntegration(role: string | null | undefined): boolean {
  return role === UserRole.INSTRUCTOR || role === UserRole.ADMIN;
}

export function toCanvasIntegrationPublic(
  integration: Pick<CanvasIntegration, "canvasUrl" | "isTestMode">,
): CanvasIntegrationPublic {
  return {
    canvasUrl: integration.canvasUrl,
    isTestMode: integration.isTestMode,
    isConnected: true,
  };
}

function encryptApiKeyIfNeeded(apiKey: string): string {
  if (isEncrypted(apiKey)) {
    return apiKey;
  }
  return encrypt(apiKey);
}

export async function getCanvasIntegrationPublic(
  userId: string,
): Promise<CanvasIntegrationPublic | null> {
  const integration = await prisma.canvasIntegration.findUnique({
    where: { userId },
    select: { canvasUrl: true, isTestMode: true },
  });

  return integration ? toCanvasIntegrationPublic(integration) : null;
}

/** Internal use: returns decrypted API key for Canvas REST calls. */
export async function getCanvasIntegrationWithDecryptedKey(userId: string) {
  const integration = await prisma.canvasIntegration.findUnique({
    where: { userId },
  });

  if (!integration) {
    return null;
  }

  return {
    ...toCanvasIntegrationPublic(integration),
    id: integration.id,
    userId: integration.userId,
    apiKey: decrypt(integration.apiKey),
  };
}

export async function saveCanvasIntegration(userId: string, input: ConnectCanvasInput) {
  const apiKeyPlaintext = input.isTestMode
    ? input.apiKey || TEST_MODE_API_KEY_PLACEHOLDER
    : input.apiKey!;

  if (!input.isTestMode) {
    await verifyCanvasCredentials(input.canvasUrl, apiKeyPlaintext);
  }

  const encryptedApiKey = encryptApiKeyIfNeeded(apiKeyPlaintext);

  const integration = await prisma.canvasIntegration.upsert({
    where: { userId },
    create: {
      userId,
      canvasUrl: input.canvasUrl,
      apiKey: encryptedApiKey,
      isTestMode: input.isTestMode,
    },
    update: {
      canvasUrl: input.canvasUrl,
      apiKey: encryptedApiKey,
      isTestMode: input.isTestMode,
    },
    select: { canvasUrl: true, isTestMode: true },
  });

  return toCanvasIntegrationPublic(integration);
}

export async function deleteCanvasIntegration(userId: string): Promise<boolean> {
  const result = await prisma.canvasIntegration.deleteMany({
    where: { userId },
  });
  return result.count > 0;
}
