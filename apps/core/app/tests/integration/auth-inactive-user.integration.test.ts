import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

describe("Better Auth inactive-user sign-in contract", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a case-variant sign-in for an inactive user without a cookie", async () => {
    const email = `inactive-auth-${randomUUID()}@ubc.ca`;
    const password = "Str0ng!Inactive-Password";
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "Inactive Auth Test", password },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const signIn = await auth.handler(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.toUpperCase(), password }),
      }),
    );

    expect(signIn.status).toBe(401);
    expect(signIn.headers.get("set-cookie")).toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("keeps case-insensitive sign-in working for an active user", async () => {
    const email = `active-auth-${randomUUID()}@ubc.ca`;
    const password = "Str0ng!Active-Password";
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "Active Auth Test", password },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    const signIn = await auth.handler(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.toUpperCase(), password }),
      }),
    );

    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-cookie")).toContain("better-auth.session_token=");
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("keeps surrounding-email-whitespace sign-in validation unchanged", async () => {
    const email = `inactive-whitespace-${randomUUID()}@ubc.ca`;
    const password = "Str0ng!Whitespace-Password";
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "Whitespace Auth Test", password },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const signIn = await auth.handler(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `  ${email}  `, password }),
      }),
    );

    expect(signIn.status).toBe(400);
    await prisma.user.delete({ where: { id: user.id } });
  });
});
