// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/invitations/service.server", () => ({
  createInvitation: vi.fn(),
  listInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "~/lib/invitations/service.server";
import {
  createAdminInvitation,
  listAdminInvitations,
  resendAdminInvitation,
  revokeAdminInvitation,
} from "~/lib/agent-tools/admin-invitations.server";

const ADMIN = { id: "a1", role: "ADMIN", name: "Admin" };
const STUDENT = { id: "s1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminInvitations", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminInvitations(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it("returns invitations for admin with counts", async () => {
    vi.mocked(listInvitations).mockResolvedValue([
      { id: "i1" } as never,
      { id: "i2" } as never,
    ]);
    const result = await listAdminInvitations(ADMIN, 10);
    expect(result).toEqual({
      invitations: [{ id: "i1" }, { id: "i2" }],
      count: 2,
      total: 2,
      truncated: false,
    });
  });

  it("clamps the limit into [1, 500] and reports truncation", async () => {
    const invitations = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }) as never);
    vi.mocked(listInvitations).mockResolvedValue(invitations);
    const result = await listAdminInvitations(ADMIN, 2);
    expect("count" in result && result.count).toBe(2);
    expect("total" in result && result.total).toBe(5);
    expect("truncated" in result && result.truncated).toBe(true);
  });
});

describe("createAdminInvitation", () => {
  const validInput = {
    email: "student@ubc.ca",
    role: "STUDENT" as const,
  };

  it("returns 403-shaped error for non-admin", async () => {
    const result = await createAdminInvitation(STUDENT, validInput);
    expect(result).toEqual({ error: "Forbidden" });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns a validation error for an invalid email", async () => {
    const result = await createAdminInvitation(ADMIN, { email: "not-an-email", role: "STUDENT" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("creates an invitation for a valid input", async () => {
    vi.mocked(createInvitation).mockResolvedValue({
      ok: true,
      invitation: { id: "inv1" } as never,
      acceptUrl: "https://app/accept/token",
      emailDelivered: true,
    });
    const result = await createAdminInvitation(ADMIN, validInput);
    expect(result).toEqual({
      invitation: { id: "inv1" },
      acceptUrl: "https://app/accept/token",
      emailDelivered: true,
    });
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: "student@ubc.ca", role: "STUDENT" }),
      { id: "a1", name: "Admin" },
    );
  });

  it("returns the service error when creation fails", async () => {
    vi.mocked(createInvitation).mockResolvedValue({
      ok: false,
      status: 409,
      error: "INVITATION_ALREADY_EXISTS",
    });
    const result = await createAdminInvitation(ADMIN, validInput);
    expect(result).toEqual({ error: "INVITATION_ALREADY_EXISTS" });
  });
});

describe("revokeAdminInvitation", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await revokeAdminInvitation(STUDENT, "inv1");
    expect(result).toEqual({ error: "Forbidden" });
    expect(revokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes an invitation for admin", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({
      ok: true,
      invitation: { id: "inv1", status: "REVOKED" } as never,
    });
    const result = await revokeAdminInvitation(ADMIN, "inv1");
    expect(result).toEqual({ invitation: { id: "inv1", status: "REVOKED" } });
  });

  it("returns the service error when revoke fails", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({
      ok: false,
      status: 404,
      error: "INVITATION_NOT_FOUND",
    });
    const result = await revokeAdminInvitation(ADMIN, "missing");
    expect(result).toEqual({ error: "INVITATION_NOT_FOUND" });
  });
});

describe("resendAdminInvitation", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await resendAdminInvitation(STUDENT, "inv1");
    expect(result).toEqual({ error: "Forbidden" });
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it("resends an invitation for admin", async () => {
    vi.mocked(resendInvitation).mockResolvedValue({
      ok: true,
      invitation: { id: "inv1" } as never,
      acceptUrl: "https://app/accept/token2",
      emailDelivered: true,
    });
    const result = await resendAdminInvitation(ADMIN, "inv1");
    expect(result).toEqual({
      invitation: { id: "inv1" },
      acceptUrl: "https://app/accept/token2",
      emailDelivered: true,
    });
    expect(resendInvitation).toHaveBeenCalledWith("inv1", { id: "a1", name: "Admin" });
  });

  it("returns the service error when resend fails", async () => {
    vi.mocked(resendInvitation).mockResolvedValue({
      ok: false,
      status: 404,
      error: "INVITATION_NOT_FOUND",
    });
    const result = await resendAdminInvitation(ADMIN, "missing");
    expect(result).toEqual({ error: "INVITATION_NOT_FOUND" });
  });
});
