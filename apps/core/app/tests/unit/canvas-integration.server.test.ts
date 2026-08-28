// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    canvasIntegration: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("~/lib/policy.server", () => ({ getPolicy: vi.fn() }));

// Save-time host validation resolves DNS; the IP-literal checks stay real.
vi.mock("~/lib/net/ssrf-guard.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/net/ssrf-guard.server")>()),
  assertPublicHostname: vi.fn(async () => {}),
}));

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
    const { CanvasStoredCredentialsError, getCanvasIntegrationWithDecryptedKey } =
      await import("~/lib/canvas/integration.server");

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
    await expect(getDashboardCanvasIntegration({ id: "u1", role: "ADMIN" })).resolves.toEqual({
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
    await expect(getDashboardCanvasIntegration({ id: "u1", role: "STUDENT" })).resolves.toBeNull();
    expect(prisma.canvasIntegration.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the caller has no integration row", async () => {
    vi.mocked(prisma.canvasIntegration.findUnique).mockResolvedValue(null);

    const getDashboardCanvasIntegration = await load();
    await expect(getDashboardCanvasIntegration({ id: "u1", role: "ADMIN" })).resolves.toBeNull();
  });
});

/**
 * `saveCanvasIntegration` is the write half of the Canvas boundary QM now
 * proxies through (#1084). A base URL that is not a bare origin plus an
 * optional deployment sub-path must never be persisted — otherwise userinfo,
 * a query, or a fragment rides along into every derived request URL and into
 * the audit trail (#1509 review).
 */
describe("saveCanvasIntegration — canonical base URL", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["embedded credentials", "https://user:pass@canvas.example.edu"],
    ["a query string", "https://canvas.example.edu/?redirect=http://169.254.169.254"],
    ["a fragment", "https://canvas.example.edu/#frag"],
  ])("rejects a base URL with %s without writing a row", async (_label, canvasUrl) => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { saveCanvasIntegration } = await import("~/lib/canvas/integration.server");
    const { CanvasVerificationError } = await import("~/lib/canvas/client.server");

    await expect(
      saveCanvasIntegration("user-1", { canvasUrl, apiKey: "k", isTestMode: true }),
    ).rejects.toBeInstanceOf(CanvasVerificationError);
    expect(prisma.canvasIntegration.upsert).not.toHaveBeenCalled();
  });

  it("persists the canonical origin + sub-path rather than the raw input", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    vi.mocked(prisma.canvasIntegration.upsert).mockResolvedValue({
      canvasUrl: "https://lms.example.edu/ubc",
      isTestMode: true,
    } as never);
    const { saveCanvasIntegration } = await import("~/lib/canvas/integration.server");

    await saveCanvasIntegration("user-1", {
      canvasUrl: "https://lms.example.edu/ubc/",
      apiKey: "k",
      isTestMode: true,
    });

    const [args] = vi.mocked(prisma.canvasIntegration.upsert).mock.calls[0];
    expect(args.create).toMatchObject({ canvasUrl: "https://lms.example.edu/ubc" });
    expect(args.update).toMatchObject({ canvasUrl: "https://lms.example.edu/ubc" });
  });
});
