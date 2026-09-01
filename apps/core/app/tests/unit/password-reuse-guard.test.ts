// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    verification: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import { resolvePasswordReuseUserId } from "~/lib/auth/password-reuse-guard.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePasswordReuseUserId", () => {
  // #225 AUTH-09: every "unresolved identity" branch below must return null
  // (fail closed) — the caller treats null as deny, never as skip-the-check.

  it("resolves the session userId for non-token paths (/change-password, /set-password)", async () => {
    const getSessionUserId = vi.fn().mockResolvedValue("session-user-1");
    const userId = await resolvePasswordReuseUserId({
      path: "/change-password",
      token: undefined,
      getSessionUserId,
    });
    expect(userId).toBe("session-user-1");
    expect(prisma.verification.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for non-token paths when there is no session", async () => {
    const getSessionUserId = vi.fn().mockResolvedValue(null);
    const userId = await resolvePasswordReuseUserId({
      path: "/change-password",
      token: undefined,
      getSessionUserId,
    });
    expect(userId).toBeNull();
  });

  it("resolves the verification's userId for a valid, unexpired reset token", async () => {
    vi.mocked(prisma.verification.findUnique).mockResolvedValue({
      value: "reset-user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const userId = await resolvePasswordReuseUserId({
      path: "/reset-password",
      token: "good-token",
      getSessionUserId: vi.fn(),
    });

    expect(userId).toBe("reset-user-1");
    expect(prisma.verification.findUnique).toHaveBeenCalledWith({
      where: { id: "reset-password:good-token" },
      select: { value: true, expiresAt: true },
    });
  });

  it("returns null when the reset token is missing from the request body", async () => {
    const userId = await resolvePasswordReuseUserId({
      path: "/reset-password",
      token: undefined,
      getSessionUserId: vi.fn(),
    });
    expect(userId).toBeNull();
    expect(prisma.verification.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the reset token does not match any verification row", async () => {
    vi.mocked(prisma.verification.findUnique).mockResolvedValue(null);
    const userId = await resolvePasswordReuseUserId({
      path: "/reset-password",
      token: "unknown-token",
      getSessionUserId: vi.fn(),
    });
    expect(userId).toBeNull();
  });

  it("returns null at (and past) the exact token expiry boundary", async () => {
    vi.mocked(prisma.verification.findUnique).mockResolvedValue({
      value: "reset-user-1",
      expiresAt: new Date(0),
    } as never);
    const userId = await resolvePasswordReuseUserId({
      path: "/reset-password",
      token: "expired-token",
      getSessionUserId: vi.fn(),
    });
    expect(userId).toBeNull();
  });

  it("never touches the session resolver for token-reset paths", async () => {
    vi.mocked(prisma.verification.findUnique).mockResolvedValue({
      value: "reset-user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const getSessionUserId = vi.fn();
    await resolvePasswordReuseUserId({
      path: "/reset-password",
      token: "good-token",
      getSessionUserId,
    });
    expect(getSessionUserId).not.toHaveBeenCalled();
  });
});
