// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Invitation } from "@prisma/client";

const prismaMock = vi.hoisted(() => {
  const tx = {
    user: { update: vi.fn() },
    invitation: { update: vi.fn() },
  };
  return {
    invitation: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    __tx: tx,
  };
});

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { handler: vi.fn() },
  authBaseURL: "http://localhost:3000",
}));

vi.mock("~/lib/auth/auth-handler-request", () => ({
  INTERNAL_INVITE_SIGNUP_HEADER: "x-eduai-invite-signup",
  buildAuthSubRequest: vi.fn((_path: string, request: Request, init: RequestInit) =>
    new Request("http://localhost/api/auth/sign-up/email", init),
  ),
}));

vi.mock("~/lib/auth/forward-session-cookies", () => ({
  appendAuthSetCookies: vi.fn(),
}));

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn(),
}));

import { getInvitationByToken, acceptInvitation } from "~/lib/invitations/service.server";
import { hashToken } from "~/lib/invitations/token.server";
import { auth } from "~/lib/auth/server";

const TOKEN = "test-invite-token";
const TOKEN_HASH = hashToken(TOKEN);

function baseInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv1",
    email: "invitee@ubc.ca",
    role: "INSTRUCTOR",
    status: "PENDING",
    tokenHash: TOKEN_HASH,
    expiresAt: new Date("2026-07-25T12:00:00.000Z"),
    authorizedUnits: [],
    invitedById: "admin1",
    acceptedAt: null,
    acceptedUserId: null,
    createdAt: new Date("2026-07-22T12:00:00.000Z"),
    updatedAt: new Date("2026-07-22T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getInvitationByToken", () => {
  // Edge-case audit #225 (AUTH-18): expiry uses strict `<` — token at exact
  // expiresAt is still valid; one millisecond past is rejected.
  it("accepts a PENDING token whose expiresAt equals now (AUTH-18 boundary)", async () => {
    const expiresAt = new Date("2026-07-25T12:00:00.000Z");
    prismaMock.invitation.findUnique.mockResolvedValue(baseInvitation({ expiresAt }));

    const result = await getInvitationByToken(TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invitation.isExpired).toBe(false);
    }
  });

  it("rejects a PENDING token one millisecond past expiresAt (AUTH-18 boundary)", async () => {
    const expiresAt = new Date("2026-07-25T11:59:59.999Z");
    prismaMock.invitation.findUnique.mockResolvedValue(baseInvitation({ expiresAt }));

    const result = await getInvitationByToken(TOKEN);

    expect(result).toEqual({ ok: false, status: 410, error: "INVITATION_EXPIRED" });
  });
});

describe("acceptInvitation TOCTOU (#225 AUTH-18)", () => {
  /**
   * Concurrent accept race (documented, not fully simulated here): acceptInvitation
   * validates PENDING + expiry once via getInvitationByToken, then sign-up runs
   * outside a transaction. The final status flip uses `update({ where: { id } })`
   * without a PENDING guard, so two callers that both pass the initial lookup can
   * race through sign-up; the second typically dead-ends on USER_EXISTS or a
   * duplicate-email sign-up failure rather than a second ACCEPTED row.
   */
  it("marks ACCEPTED without re-checking PENDING on the final invitation update", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(baseInvitation());
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "new-u1", email: "invitee@ubc.ca", role: "STUDENT" });
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(null, { status: 200, headers: { "Set-Cookie": "session=1" } }),
    );
    prismaMock.__tx.user.update.mockResolvedValue({
      id: "new-u1",
      email: "invitee@ubc.ca",
      role: "INSTRUCTOR",
    });
    prismaMock.__tx.invitation.update.mockResolvedValue({});

    const result = await acceptInvitation(
      { token: TOKEN, name: "Invitee", password: "password1", confirmPassword: "password1" },
      new Request("http://localhost/auth/accept-invitation"),
    );

    expect(result.ok).toBe(true);
    expect(prismaMock.__tx.invitation.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: expect.objectContaining({ status: "ACCEPTED" }),
    });
  });
});
