// @vitest-environment node
//
// UNIT_ADMINs may only see and act on invitations they created; ADMINs are
// unscoped. Pins the ownership scoping added for PR #685.

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  invitation: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  listInvitations,
  revokeInvitation,
  resendInvitation,
} from "~/lib/invitations/service.server";

const ADMIN = { id: "admin-1", name: "Ada", role: "ADMIN" };
const UNIT_ADMIN = { id: "ua-1", name: "Uma", role: "UNIT_ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.invitation.findMany.mockResolvedValue([]);
});

describe("listInvitations scoping", () => {
  it("returns all invitations for an ADMIN (no where filter)", async () => {
    await listInvitations(ADMIN);
    expect(prismaMock.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it("scopes a UNIT_ADMIN to invitations they created", async () => {
    await listInvitations(UNIT_ADMIN);
    expect(prismaMock.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { invitedById: UNIT_ADMIN.id } }),
    );
  });
});

describe("revokeInvitation ownership", () => {
  it("forbids a UNIT_ADMIN revoking an invite they did not create", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "PENDING",
      invitedById: "someone-else",
    });
    const result = await revokeInvitation("inv-1", UNIT_ADMIN);
    expect(result).toEqual({ ok: false, status: 403, error: "FORBIDDEN" });
    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to revoke any invite", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "PENDING",
      invitedById: "someone-else",
    });
    prismaMock.invitation.update.mockResolvedValue({
      id: "inv-1",
      status: "REVOKED",
      expiresAt: new Date(Date.now() + 1000),
    });
    const result = await revokeInvitation("inv-1", ADMIN);
    expect(result.ok).toBe(true);
    expect(prismaMock.invitation.update).toHaveBeenCalled();
  });
});

describe("resendInvitation ownership", () => {
  it("forbids a UNIT_ADMIN resending an invite they did not create", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "PENDING",
      invitedById: "someone-else",
    });
    const result = await resendInvitation("inv-1", UNIT_ADMIN);
    expect(result).toEqual({ ok: false, status: 403, error: "FORBIDDEN" });
    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
  });
});
