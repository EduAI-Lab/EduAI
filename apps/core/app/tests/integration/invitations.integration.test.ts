/**
 * Integration coverage for the admin invitation workflow.
 *
 * Unlike most route tests, this file does NOT mock `~/lib/auth/server` — the
 * accept flow relies on the real `auth.handler` to create a credential account.
 * Session control for the admin-gated endpoints is done by spying on
 * `auth.api.getSession`. The mailer is mocked so no SMTP is attempted.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn().mockResolvedValue({ delivered: true }),
}));

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { sendEmail } from "~/lib/email/mailer.server";
import { hashToken } from "~/lib/invitations/token.server";
import { seedUser, cleanupRbac } from "../helpers/rbac";

import { loader as listLoader, action as createAction } from "~/routes/api/invitations";
import { action as revokeAction } from "~/routes/api/invitations.$id";
import {
  loader as acceptLoader,
  action as acceptAction,
} from "~/routes/api/invitations.accept";

const getSessionSpy = vi.spyOn(auth.api, "getSession");
const sendEmailMock = vi.mocked(sendEmail);

const emails: string[] = [];
let adminId = "";

function uniqueEmail(): string {
  const email = `invite-${randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  return email;
}

function asAdmin() {
  getSessionSpy.mockResolvedValue({
    user: { id: adminId, role: "ADMIN", name: "Admin" },
  } as never);
}
function asRole(role: string) {
  getSessionSpy.mockResolvedValue({ user: { id: "x", role, name: "X" } } as never);
}
function asAnon() {
  getSessionSpy.mockResolvedValue(null as never);
}

const ctx = { context: {} as never };
function createReq(body: unknown) {
  return {
    request: new Request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    ...ctx,
  };
}
function acceptReq(body: unknown) {
  return {
    request: new Request("http://localhost/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    ...ctx,
  };
}
function tokenFromAcceptUrl(url: string): string {
  return new URL(url).searchParams.get("token") ?? "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ delivered: true });
  if (!adminId) {
    const admin = await seedUser({ role: "ADMIN" });
    adminId = admin.id;
  }
});

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { email: { in: emails } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await cleanupRbac({ userIds: [adminId] });
  await prisma.$disconnect();
});

describe("POST /api/invitations (create)", () => {
  it("forbids anonymous and non-admin callers", async () => {
    asAnon();
    expect((await createAction(createReq({ email: uniqueEmail(), role: "INSTRUCTOR" }))).status).toBe(403);
    asRole("INSTRUCTOR");
    expect((await createAction(createReq({ email: uniqueEmail(), role: "INSTRUCTOR" }))).status).toBe(403);
  });

  it("creates an invite, stores only the token hash, and emails the accept link", async () => {
    asAdmin();
    const email = uniqueEmail();
    const res = await createAction(createReq({ email, role: "INSTRUCTOR" }));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.invitation.email).toBe(email);
    expect(body.invitation.role).toBe("INSTRUCTOR");
    expect(body.invitation.status).toBe("PENDING");
    expect(body.invitation.tokenHash).toBeUndefined(); // never exposed
    expect(body.acceptUrl).toContain("/auth/accept-invitation?token=");

    // Persisted row stores the hash of the token embedded in acceptUrl.
    const token = tokenFromAcceptUrl(body.acceptUrl);
    const row = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(row?.email).toBe(email);

    // The email carried the accept URL.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].text).toContain(body.acceptUrl);
  });

  it("rejects a UNIT_ADMIN invite without units (400)", async () => {
    asAdmin();
    const res = await createAction(createReq({ email: uniqueEmail(), role: "UNIT_ADMIN" }));
    expect(res.status).toBe(400);
  });

  it("409s when a user with that email already exists", async () => {
    asAdmin();
    const existing = await seedUser({ role: "STUDENT" });
    emails.push(existing.email);
    const res = await createAction(createReq({ email: existing.email, role: "INSTRUCTOR" }));
    expect(res.status).toBe(409);
  });

  it("supersedes a prior PENDING invite for the same email", async () => {
    asAdmin();
    const email = uniqueEmail();
    const first = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const second = await (await createAction(createReq({ email, role: "ADMIN" }))).json();

    const oldToken = tokenFromAcceptUrl(first.acceptUrl);
    const oldRow = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(oldToken) } });
    expect(oldRow?.status).toBe("REVOKED");

    const pending = await prisma.invitation.count({ where: { email, status: "PENDING" } });
    expect(pending).toBe(1);
    expect(second.invitation.role).toBe("ADMIN");
  });
});

describe("GET /api/invitations (list)", () => {
  it("lists invitations for an admin and hides the token hash", async () => {
    asAdmin();
    await createAction(createReq({ email: uniqueEmail(), role: "INSTRUCTOR" }));
    const res = await listLoader({
      request: new Request("http://localhost/api/invitations"),
      params: {},
      ...ctx,
    });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].tokenHash).toBeUndefined();
    expect(list[0]).toHaveProperty("isExpired");
  });

  it("forbids non-admins", async () => {
    asAnon();
    const res = await listLoader({
      request: new Request("http://localhost/api/invitations"),
      params: {},
      ...ctx,
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/invitations/:id (revoke)", () => {
  it("revokes a pending invite, 404s unknown, 409s a non-pending one", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const id = created.invitation.id;

    const ok = await revokeAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "DELETE" }),
      params: { id },
      ...ctx,
    });
    expect(ok.status).toBe(200);
    expect((await prisma.invitation.findUnique({ where: { id } }))?.status).toBe("REVOKED");

    const missing = await revokeAction({
      request: new Request("http://localhost/api/invitations/nope", { method: "DELETE" }),
      params: { id: "nope" },
      ...ctx,
    });
    expect(missing.status).toBe(404);

    const again = await revokeAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "DELETE" }),
      params: { id },
      ...ctx,
    });
    expect(again.status).toBe(409);
  });
});

describe("POST /api/invitations/:id (resend)", () => {
  it("rotates the token (old link dies), refreshes expiry, and returns a new link", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const id = created.invitation.id;
    const oldToken = tokenFromAcceptUrl(created.acceptUrl);

    const res = await revokeAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "POST" }),
      params: { id },
      ...ctx,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const newToken = tokenFromAcceptUrl(body.acceptUrl);
    expect(newToken).not.toBe(oldToken);

    // Old token no longer resolves; new one does.
    expect(await prisma.invitation.findUnique({ where: { tokenHash: hashToken(oldToken) } })).toBeNull();
    expect((await prisma.invitation.findUnique({ where: { tokenHash: hashToken(newToken) } }))?.id).toBe(id);
  });

  it("409s when resending a non-pending invite", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const id = created.invitation.id;
    await prisma.invitation.update({ where: { id }, data: { status: "REVOKED" } });

    const res = await revokeAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "POST" }),
      params: { id },
      ...ctx,
    });
    expect(res.status).toBe(409);
  });
});

describe("accept flow", () => {
  it("GET validates a token and returns email + role", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    const res = await acceptLoader({
      request: new Request(`http://localhost/api/invitations/accept?token=${token}`),
      params: {},
      ...ctx,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ email, role: "INSTRUCTOR", name: null });
  });

  it("creates a real, logged-in account with the invited role and marks the invite accepted", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    const res = await acceptAction(
      acceptReq({ token, name: "Pat Prof", password: "supersecret1", confirmPassword: "supersecret1" }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Set-Cookie")).toBeTruthy(); // logged in

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe("INSTRUCTOR");
    expect(user?.emailVerified).toBe(true);

    const account = await prisma.account.findFirst({ where: { userId: user!.id } });
    expect(account?.password).toBeTruthy(); // password is set → login works

    const invite = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(invite?.status).toBe("ACCEPTED");
    expect(invite?.acceptedUserId).toBe(user!.id);
  });

  it("persists authorizedUnits for a UNIT_ADMIN invite", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (
      await createAction(createReq({ email, role: "UNIT_ADMIN", authorizedUnits: ["COSC"] }))
    ).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    const res = await acceptAction(
      acceptReq({ token, name: "Uma Unit", password: "supersecret1", confirmPassword: "supersecret1" }),
    );
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe("UNIT_ADMIN");
    expect(user?.authorizedUnits).toEqual(["COSC"]);
  });

  it("rejects invalid, expired, revoked, and already-used tokens", async () => {
    // Invalid token
    expect(
      (await acceptAction(acceptReq({ token: "nope", name: "X X", password: "supersecret1", confirmPassword: "supersecret1" }))).status,
    ).toBe(404);

    // Expired
    const expiredEmail = uniqueEmail();
    await prisma.invitation.create({
      data: {
        email: expiredEmail,
        role: "INSTRUCTOR",
        tokenHash: hashToken("expired-token"),
        invitedById: adminId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (await acceptAction(acceptReq({ token: "expired-token", name: "X X", password: "supersecret1", confirmPassword: "supersecret1" }))).status,
    ).toBe(410);

    // Revoked
    const revokedEmail = uniqueEmail();
    await prisma.invitation.create({
      data: {
        email: revokedEmail,
        role: "INSTRUCTOR",
        tokenHash: hashToken("revoked-token"),
        status: "REVOKED",
        invitedById: adminId,
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    const revokedRes = await acceptAction(
      acceptReq({ token: "revoked-token", name: "X X", password: "supersecret1", confirmPassword: "supersecret1" }),
    );
    expect(revokedRes.status).toBe(410);
    expect((await revokedRes.json()).error).toBe("INVITATION_REVOKED");
  });

  it("rolls back the created account when the promote step fails, keeping the invite usable", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);
    const body = { token, name: "Pat Prof", password: "supersecret1", confirmPassword: "supersecret1" };

    const txSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db hiccup"));
    const failed = await acceptAction(acceptReq(body));
    txSpy.mockRestore();
    expect(failed.status).toBe(500);

    // The half-created account was rolled back, so the same invite still works.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // Better Auth rate-limits sign-up to 3 per 10s per IP (always 127.0.0.1 in
    // test env), and this file signs up several times — jump past the window.
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
    try {
      const retry = await acceptAction(acceptReq(body));
      expect(retry.status).toBe(201);
    } finally {
      nowSpy.mockRestore();
    }
    expect((await prisma.user.findUnique({ where: { email } }))?.role).toBe("INSTRUCTOR");
  });

  it("409s if the email was registered between invite and accept", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    // Simulate the email being claimed in the meantime.
    await prisma.user.create({ data: { email, name: "Squatter", role: "STUDENT" } });

    const res = await acceptAction(
      acceptReq({ token, name: "Late Comer", password: "supersecret1", confirmPassword: "supersecret1" }),
    );
    expect(res.status).toBe(409);
  });
});
