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

vi.mock("~/lib/policy.server", () => ({ getPolicy: vi.fn() }));

import prisma from "~/lib/prisma.server";
import { getPolicy } from "~/lib/policy.server";

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

/**
 * The dashboard loader reads the Canvas card's integration in-process (#1220),
 * which bypasses the route middleware on `GET /api/canvas/integration` — so the
 * helper has to re-apply that route's role guard and INSTRUCTOR policy gate
 * itself. A caller who would have been 403'd must get `null`, and no row read.
 */
describe("getDashboardCanvasIntegration", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const load = async () =>
    (await import("~/lib/canvas/integration.server")).getDashboardCanvasIntegration;

  const connectedRow = { canvasUrl: "https://canvas.ubc.ca", isTestMode: false };

  it("returns the integration for an ADMIN without consulting the policy", async () => {
    vi.mocked(prisma.canvasIntegration.findUnique).mockResolvedValue(connectedRow as never);

    const getDashboardCanvasIntegration = await load();
    await expect(
      getDashboardCanvasIntegration({ id: "u1", role: "ADMIN" }),
    ).resolves.toEqual({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    });
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("returns the integration for an INSTRUCTOR when the policy is on", async () => {
    vi.mocked(getPolicy).mockResolvedValue(true);
    vi.mocked(prisma.canvasIntegration.findUnique).mockResolvedValue(connectedRow as never);

    const getDashboardCanvasIntegration = await load();
    await expect(
      getDashboardCanvasIntegration({ id: "u1", role: "INSTRUCTOR" }),
    ).resolves.toMatchObject({ isConnected: true });
    expect(getPolicy).toHaveBeenCalledWith("instructors.canManageCanvasIntegration");
  });

  it("returns null for an INSTRUCTOR when the policy is off, without reading the row", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);

    const getDashboardCanvasIntegration = await load();
    await expect(
      getDashboardCanvasIntegration({ id: "u1", role: "INSTRUCTOR" }),
    ).resolves.toBeNull();
    expect(prisma.canvasIntegration.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a role that cannot manage Canvas", async () => {
    const getDashboardCanvasIntegration = await load();
    await expect(
      getDashboardCanvasIntegration({ id: "u1", role: "STUDENT" }),
    ).resolves.toBeNull();
    expect(prisma.canvasIntegration.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the caller has no integration row", async () => {
    vi.mocked(prisma.canvasIntegration.findUnique).mockResolvedValue(null);

    const getDashboardCanvasIntegration = await load();
    await expect(
      getDashboardCanvasIntegration({ id: "u1", role: "ADMIN" }),
    ).resolves.toBeNull();
  });
});
