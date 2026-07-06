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
import { setPolicy, invalidatePolicyCache } from "~/lib/policy.server";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { seedUser, cleanupRbac } from "../helpers/rbac";

import { loader as listLoader, action as createAction } from "~/routes/api/invitations";
import { action as invitationIdAction } from "~/routes/api/invitations.$id";
// The accept flow has a single live path: the user-facing page route. There is no
// API equivalent, so the page's loader/action are what we drive here.
import {
  loader as acceptLoader,
  action as acceptAction,
} from "~/routes/auth/accept-invitation";

const getSessionSpy = vi.spyOn(auth.api, "getSession");
const sendEmailMock = vi.mocked(sendEmail);

/** Satisfies UBC password policy (#339) in accept-flow integration tests. */
const INVITE_TEST_PASSWORD = "SuperSecret1!";

const emails: string[] = [];
let adminId = "";
let unitAdminId = "";

function uniqueEmail(): string {
  const email = `invite-${randomUUID().slice(0, 8)}@ubc.ca`;
  emails.push(email);
  return email;
}

function asAdmin() {
  getSessionSpy.mockResolvedValue({
    user: { id: adminId, role: "ADMIN", name: "Admin" },
  } as never);
}
function asUnitAdmin() {
  getSessionSpy.mockResolvedValue({
    user: { id: unitAdminId, role: "UNIT_ADMIN", name: "Unit Admin" },
  } as never);
}
function asRole(role: string) {
  getSessionSpy.mockResolvedValue({ user: { id: "x", role, name: "X" } } as never);
}
function asAnon() {
  getSessionSpy.mockResolvedValue(null as never);
}

const ctx = { context: {} as never } as any;
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
// The page action consumes form-encoded data (it backs a <Form method="post">),
// not JSON, so accept requests are built as url-encoded form bodies.
function acceptReq(fields: Record<string, string>) {
  return {
    request: new Request("http://localhost/auth/accept-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
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
  if (!unitAdminId) {
    const ua = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    unitAdminId = ua.id;
  }
});

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { email: { in: emails } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.systemConfig.deleteMany({
    where: { key: { in: ["policy.unitAdmins.canInvite", "policy.auth.allowPublicRegistration"] } },
  });
  invalidatePolicyCache();
  await cleanupRbac({ userIds: [adminId, unitAdminId] });
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

  it("rejects a non-UBC invite email (400, #567)", async () => {
    asAdmin();
    const res = await createAction(createReq({ email: "prof@gmail.com", role: "INSTRUCTOR" }));
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

  it("lets an ADMIN invite a STUDENT", async () => {
    asAdmin();
    const email = uniqueEmail();
    const res = await createAction(createReq({ email, role: "STUDENT" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.role).toBe("STUDENT");
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

    const ok = await invitationIdAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "DELETE" }),
      params: { id },
      ...ctx,
    });
    expect(ok.status).toBe(200);
    expect((await prisma.invitation.findUnique({ where: { id } }))?.status).toBe("REVOKED");

    const missing = await invitationIdAction({
      request: new Request("http://localhost/api/invitations/nope", { method: "DELETE" }),
      params: { id: "nope" },
      ...ctx,
    });
    expect(missing.status).toBe(404);

    const again = await invitationIdAction({
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

    const res = await invitationIdAction({
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

    const res = await invitationIdAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "POST" }),
      params: { id },
      ...ctx,
    });
    expect(res.status).toBe(409);
  });
});

describe("unit-admin invitations (unitAdmins.canInvite)", () => {
  // These tests flip unitAdmins.canInvite on; reset it (DB row + policy cache)
  // when the block finishes so its on-state can't leak into later describes.
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({
      where: { key: "policy.unitAdmins.canInvite" },
    });
    invalidatePolicyCache();
  });

  it("denies a UNIT_ADMIN while the flag is off (403)", async () => {
    await setPolicy("unitAdmins.canInvite", false, adminId);
    asUnitAdmin();
    const res = await createAction(createReq({ email: uniqueEmail(), role: "INSTRUCTOR" }));
    expect(res.status).toBe(403);
  });

  it("lets a UNIT_ADMIN invite a STUDENT when the flag is on, and the student can accept", async () => {
    await setPolicy("unitAdmins.canInvite", true, adminId);
    asUnitAdmin();
    const email = uniqueEmail();
    const created = await createAction(createReq({ email, role: "STUDENT" }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.invitation.role).toBe("STUDENT");
    expect(body.invitation.invitedById).toBe(unitAdminId);

    const token = tokenFromAcceptUrl(body.acceptUrl);
    const res = (await acceptAction(
      acceptReq({ token, name: "Sam Student", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as Response;
    expect(res.status).toBe(302);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe("STUDENT");
    expect(user?.authorizedUnits).toEqual([]);
  });

  it("forbids a UNIT_ADMIN from inviting an ADMIN (403 FORBIDDEN_ROLE)", async () => {
    await setPolicy("unitAdmins.canInvite", true, adminId);
    asUnitAdmin();
    const res = await createAction(createReq({ email: uniqueEmail(), role: "ADMIN" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN_ROLE" });
  });

  it("rejects a non-UBC student invite from a unit admin (400, #567)", async () => {
    await setPolicy("unitAdmins.canInvite", true, adminId);
    asUnitAdmin();
    const res = await createAction(createReq({ email: "stu@gmail.com", role: "STUDENT" }));
    expect(res.status).toBe(400);
  });

  it("scopes the list to invitations the unit admin sent", async () => {
    await setPolicy("unitAdmins.canInvite", true, adminId);

    // An admin-issued invite the unit admin must not see.
    asAdmin();
    const adminInviteEmail = uniqueEmail();
    await createAction(createReq({ email: adminInviteEmail, role: "INSTRUCTOR" }));

    // The unit admin's own invite.
    asUnitAdmin();
    const ownEmail = uniqueEmail();
    await createAction(createReq({ email: ownEmail, role: "INSTRUCTOR" }));

    const res = await listLoader({
      request: new Request("http://localhost/api/invitations"),
      params: {},
      ...ctx,
    });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.every((i: { invitedById: string }) => i.invitedById === unitAdminId)).toBe(true);
    const listedEmails = list.map((i: { email: string }) => i.email);
    expect(listedEmails).toContain(ownEmail);
    expect(listedEmails).not.toContain(adminInviteEmail);
  });

  it("revoking another inviter's invitation reads as not-found (404)", async () => {
    await setPolicy("unitAdmins.canInvite", true, adminId);

    asAdmin();
    const created = await (
      await createAction(createReq({ email: uniqueEmail(), role: "INSTRUCTOR" }))
    ).json();
    const id = created.invitation.id;

    asUnitAdmin();
    const res = await invitationIdAction({
      request: new Request(`http://localhost/api/invitations/${id}`, { method: "DELETE" }),
      params: { id },
      ...ctx,
    });
    expect(res.status).toBe(404);
    // The admin's invite is untouched.
    expect((await prisma.invitation.findUnique({ where: { id } }))?.status).toBe("PENDING");
  });
});

describe("accept flow", () => {
  it("loader validates a token and returns email + role", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    const res = (await acceptLoader({
      request: new Request(`http://localhost/auth/accept-invitation?token=${token}`),
      params: {},
      ...ctx,
    })) as any;
    expect(res).toMatchObject({ ok: true, email, role: "INSTRUCTOR", name: null });
  });

  it("creates a real, logged-in account with the invited role and marks the invite accepted", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    const res = (await acceptAction(
      acceptReq({ token, name: "Pat Prof", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as Response;
    expect(res.status).toBe(302); // redirected to /dashboard on success
    expect(res.headers.get("Location")).toBe("/dashboard");
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

    const res = (await acceptAction(
      acceptReq({ token, name: "Uma Unit", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as Response;
    expect(res.status).toBe(302);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe("UNIT_ADMIN");
    expect(user?.authorizedUnits).toEqual(["COSC"]);
  });

  it("creates a STUDENT account from an admin invite (no authorized units)", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "STUDENT" }))).json();
    expect(created.invitation.role).toBe("STUDENT");
    const token = tokenFromAcceptUrl(created.acceptUrl);

    // Better Auth rate-limits sign-up to 3 per 10s per IP and this file already
    // signs up that many in-window — jump past the window for this extra one.
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
    let res: Response;
    try {
      res = (await acceptAction(
        acceptReq({ token, name: "Sam Student", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
      )) as Response;
    } finally {
      nowSpy.mockRestore();
    }
    expect(res.status).toBe(302);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe("STUDENT");
    expect(user?.authorizedUnits).toEqual([]);
  });

  it("accepts an invite even when public registration is disabled", async () => {
    // Regression: invite acceptance reuses /sign-up/email, which the §6a hook
    // gates on auth.allowPublicRegistration. The invitee was vetted by an admin,
    // so the gate must not block them (the sub-request carries an internal
    // marker). Before the fix this returned { formError: "Something went
    // wrong…" } with HTTP 200 instead of creating the account.
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    await setPolicy("auth.allowPublicRegistration", false, adminId);
    try {
      // Step past Better Auth's per-IP sign-up rate window (see note below).
      const realNow = Date.now;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
      let res: Response;
      try {
        res = (await acceptAction(
          acceptReq({ token, name: "Reg Off", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
        )) as Response;
      } finally {
        nowSpy.mockRestore();
      }
      expect(res.status).toBe(302); // account created + logged in despite the gate
      expect(res.headers.get("Location")).toBe("/dashboard");
      expect((await prisma.user.findUnique({ where: { email } }))?.role).toBe("INSTRUCTOR");
    } finally {
      await setPolicy("auth.allowPublicRegistration", true, adminId);
    }
  });

  it("surfaces a friendly error for invalid, expired, and revoked tokens", async () => {
    // The page action returns { formError } (a friendly message), not a status code.
    // Invalid token
    const invalid = (await acceptAction(
      acceptReq({ token: "nope", name: "X X", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as any;
    expect(invalid.formError).toMatch(/invalid/i);

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
    const expired = (await acceptAction(
      acceptReq({ token: "expired-token", name: "X X", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as any;
    expect(expired.formError).toMatch(/expired/i);

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
    const revoked = (await acceptAction(
      acceptReq({ token: "revoked-token", name: "X X", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as any;
    expect(revoked.formError).toMatch(/cancelled/i);
  });

  it("rolls back the created account when the promote step fails, keeping the invite usable", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);
    const body = { token, name: "Pat Prof", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD };

    // recordPasswordHistory (called during Better Auth sign-up) uses $transaction
    // too, so we let the first call pass and reject only the second one (promote).
    let txCallCount = 0;
    const realTx = prisma.$transaction.bind(prisma);
    const txSpy = vi.spyOn(prisma, "$transaction").mockImplementation((...args: Parameters<typeof prisma.$transaction>) => {
      txCallCount++;
      if (txCallCount < 2) return (realTx as any)(...args);
      return Promise.reject(new Error("db hiccup"));
    });
    const failed = (await acceptAction(acceptReq(body))) as any;
    txSpy.mockRestore();
    expect(failed.formError).toBeTruthy(); // surfaced as a form error, not a redirect

    // The half-created account was rolled back, so the same invite still works.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // Better Auth rate-limits sign-up to 3 per 10s per IP (always 127.0.0.1 in
    // test env), and this file signs up several times — jump past the window.
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
    try {
      const retry = (await acceptAction(acceptReq(body))) as Response;
      expect(retry.status).toBe(302);
    } finally {
      nowSpy.mockRestore();
    }
    expect((await prisma.user.findUnique({ where: { email } }))?.role).toBe("INSTRUCTOR");
  });

  it("rejects accepting when the email was registered between invite and accept", async () => {
    asAdmin();
    const email = uniqueEmail();
    const created = await (await createAction(createReq({ email, role: "INSTRUCTOR" }))).json();
    const token = tokenFromAcceptUrl(created.acceptUrl);

    // Simulate the email being claimed in the meantime.
    await prisma.user.create({ data: { email, name: "Squatter", role: "STUDENT" } });

    const res = (await acceptAction(
      acceptReq({ token, name: "Late Comer", password: INVITE_TEST_PASSWORD, confirmPassword: INVITE_TEST_PASSWORD }),
    )) as any;
    expect(res.formError).toMatch(/already exists/i);

    // The invite can never be accepted now, so it is revoked rather than left
    // PENDING with a live link lingering until natural expiry.
    const invite = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(invite?.status).toBe("REVOKED");
  });
});

describe("public registration — UBC backend gate (§567)", () => {
  // Drives auth.handler directly with a public /sign-up/email request (NO invite
  // marker) so the §567 check inside the before-hook runs — the backend layer
  // that catches API calls bypassing register.tsx's signUpSchema. Both cases use
  // a Date.now offset to land past Better Auth's per-IP sign-up rate window.
  function publicSignup(email: string): Promise<Response> {
    const base = new Request("http://localhost/auth/register");
    const req = buildAuthSubRequest("/api/auth/sign-up/email", base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Public User", email, password: INVITE_TEST_PASSWORD }),
    });
    return auth.handler(req);
  }

  it("rejects a non-UBC public signup and creates no account", async () => {
    const email = `public-reject-${randomUUID().slice(0, 8)}@gmail.com`;
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
    let res: Response;
    try {
      res = await publicSignup(email);
    } finally {
      nowSpy.mockRestore();
    }
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("allows a UBC public signup (proves the hook reads the email, not a blanket block)", async () => {
    const email = uniqueEmail(); // @ubc.ca, tracked for cleanup
    const realNow = Date.now;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 22_000);
    let res: Response;
    try {
      res = await publicSignup(email);
    } finally {
      nowSpy.mockRestore();
    }
    expect(res.ok).toBe(true);
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });
});
