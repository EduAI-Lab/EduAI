// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    canvasIntegration: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";

describe("getCanvasIntegrationWithDecryptedKey", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("throws CanvasStoredCredentialsError when decrypt fails after key rotation", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { encrypt } = await import("~/lib/canvas/encryption");
    const {
      CanvasStoredCredentialsError,
      getCanvasIntegrationWithDecryptedKey,
    } = await import("~/lib/canvas/integration.server");

    const encryptedApiKey = encrypt("canvas-token");
    vi.mocked(prisma.canvasIntegration.findUnique).mockResolvedValue({
      id: "int-1",
      userId: "user-1",
      canvasUrl: "https://canvas.example.edu",
      apiKey: encryptedApiKey,
      isTestMode: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.stubEnv("ENCRYPTION_KEY", "a-different-encryption-key-value");

    await expect(getCanvasIntegrationWithDecryptedKey("user-1")).rejects.toThrow(
      CanvasStoredCredentialsError,
    );
  });
});
