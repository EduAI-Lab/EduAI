import type { CanvasIntegration } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import {
  CanvasCredentialDecryptError,
  decrypt,
  encrypt,
  isEncrypted,
} from "~/lib/canvas/encryption";
import type { CanvasIntegrationPublic, ConnectCanvasInput } from "~/lib/canvas/schemas";
import {
  assertSafeCanvasSaveHost,
  parseAndValidateCanvasUrl,
  verifyCanvasCredentials,
} from "~/lib/canvas/client.server";

import { canManageCanvasIntegration } from "~/lib/canvas/guards.server";
import { getPolicy } from "~/lib/policy.server";

const TEST_MODE_API_KEY_PLACEHOLDER = "test-key";

export { canManageCanvasIntegration };

/** Raised when stored Canvas credentials cannot be decrypted (e.g. after key rotation). */
export class CanvasStoredCredentialsError extends Error {
  constructor() {
    super("Stored Canvas credentials could not be decrypted. Reconnect Canvas in Settings.");
    this.name = "CanvasStoredCredentialsError";
  }
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

/**
 * Dashboard SSR (#1220): resolve the Canvas card's integration in the loader so
 * the card paints connected/not-connected on first byte instead of mounting a
 * spinner and then fetching `GET /api/canvas/integration`.
 *
 * Mirrors that route's two gates — the role guard and the INSTRUCTOR-only
 * policy check — because reading the row through this in-process path skips the
 * route's middleware. A caller who would have received `403` gets `null`, which
 * is what the card renders for "not connected" anyway.
 */
export async function getDashboardCanvasIntegration(user: {
  id: string;
  role?: string | null;
}): Promise<CanvasIntegrationPublic | null> {
  if (!canManageCanvasIntegration(user.role)) return null;
  if (
    user.role === "INSTRUCTOR" &&
    !(await getPolicy("instructors.canManageCanvasIntegration"))
  ) {
    return null;
  }
  return getCanvasIntegrationPublic(user.id);
}

/** Internal use: returns decrypted API key for Canvas REST calls. */
export async function getCanvasIntegrationWithDecryptedKey(userId: string) {
  const integration = await prisma.canvasIntegration.findUnique({
    where: { userId },
  });

  if (!integration) {
    return null;
  }

  let apiKey: string;
  try {
    apiKey = decrypt(integration.apiKey);
  } catch (error) {
    if (error instanceof CanvasCredentialDecryptError) {
      throw new CanvasStoredCredentialsError();
    }
    throw error;
  }

  return {
    ...toCanvasIntegrationPublic(integration),
    id: integration.id,
    userId: integration.userId,
    apiKey,
  };
}

export async function saveCanvasIntegration(userId: string, input: ConnectCanvasInput) {
  const parsed = parseAndValidateCanvasUrl(input.canvasUrl);

  // Runs for test mode too. The DNS-backed check used to be reachable only via
  // verifyCanvasCredentials in the branch below, so a test-mode save could
  // persist a URL pointing at an internal host that nothing had validated.
  await assertSafeCanvasSaveHost(parsed);

  let apiKeyPlaintext: string;

  if (input.isTestMode) {
    apiKeyPlaintext = input.apiKey ?? TEST_MODE_API_KEY_PLACEHOLDER;
  } else {
    const apiKey = input.apiKey;
    if (!apiKey) {
      throw new Error("API key is required unless using test mode");
    }
    apiKeyPlaintext = apiKey;
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
