/**
 * #971 — a deactivated user (`isActive: false`) must not be able to sign in,
 * and an existing session must stop working the moment the user is
 * deactivated. Drives the real `auth` instance (no mocking) against the test
 * DB so the better-auth hook pipeline in `~/lib/auth/server.ts` actually runs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";

const PASSWORD = "SuperSecret1!";
const emails: string[] = [];

function uniqueEmail(): string {
  const email = `isactive-${randomUUID().slice(0, 8)}@ubc.ca`;
  emails.push(email);
  return email;
}

function signUp(email: string): Promise<Response> {
  const base = new Request("http://localhost/auth/register");
  const req = buildAuthSubRequest("/api/auth/sign-up/email", base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "IsActive Test", email, password: PASSWORD }),
  });
  return auth.handler(req);
}

function signIn(email: string, password = PASSWORD): Promise<Response> {
  const base = new Request("http://localhost/auth/login");
  const req = buildAuthSubRequest("/api/auth/sign-in/email", base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return auth.handler(req);
}

function cookieHeaderFrom(res: Response): string {
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("#971 — isActive enforcement at sign-in and session guard", () => {
  it("allows sign-in for an active user (control case)", async () => {
    const email = uniqueEmail();
    await signUp(email);

    const res = await signIn(email);

    expect(res.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("rejects credential sign-in for a deactivated user without creating a session", async () => {
    const email = uniqueEmail();
    await signUp(email);
    await prisma.user.update({ where: { email }, data: { isActive: false } });

    const res = await signIn(email);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeFalsy();

    const body = (await res.json()) as { message?: string; error?: string };
    expect(body.message ?? body.error).toMatch(/invalid email or password/i);
  });

  it("invalidates an existing session the moment the user is deactivated", async () => {
    const email = uniqueEmail();
    const signUpRes = await signUp(email);
    const cookie = cookieHeaderFrom(signUpRes);
    expect(cookie).toBeTruthy();

    const sessionBefore = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(sessionBefore?.user?.email).toBe(email);
    const sessionToken = sessionBefore!.session.token;
    expect(await prisma.session.findUnique({ where: { token: sessionToken } })).not.toBeNull();

    await prisma.user.update({ where: { email }, data: { isActive: false } });

    const sessionAfter = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(sessionAfter).toBeNull();

    // The orphaned session row is revoked too, not just masked at read time.
    expect(await prisma.session.findUnique({ where: { token: sessionToken } })).toBeNull();
  });
});
