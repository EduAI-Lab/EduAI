import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { auth } from "~/lib/auth/server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { resetMailerTransport } from "~/lib/email/mailer.server";
import prisma from "~/lib/prisma.server";

const PASSWORD = "Verification1!";
const emails: string[] = [];

function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function signIn(email: string): Promise<Response> {
  return auth.handler(
    buildAuthSubRequest("/api/auth/sign-in/email", new Request("http://localhost/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        callbackURL: "/onboarding/student-id",
      }),
    }),
  );
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("public signup email verification", () => {
  it("blocks every unverified session path and restores login after the Better Auth link", async () => {
    const email = `verify-${randomUUID().slice(0, 8)}@ubc.ca`;
    emails.push(email);
    const originalSmtpHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    resetMailerTransport();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const signupRequest = buildAuthSubRequest(
        "/api/auth/sign-up/email",
        new Request("http://localhost/auth/register"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Verification Test",
            email,
            password: PASSWORD,
            callbackURL: "/onboarding/student-id",
          }),
        },
      );

      const signupResponse = await auth.handler(signupRequest);
      expect(signupResponse.ok).toBe(true);
      expect(signupResponse.headers.get("Set-Cookie")).toBeNull();
      expect((await prisma.user.findUnique({ where: { email } }))?.emailVerified).toBe(false);

      const mailLog = consoleSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes(email));
      const verificationUrl = mailLog?.match(/https?:\/\/\S+\/verify-email\?\S+/)?.[0];
      expect(Boolean(verificationUrl)).toBe(true);
      if (!verificationUrl) throw new Error("Verification email did not contain a link");

      const unverifiedSignIn = await signIn(email);
      expect(unverifiedSignIn.status).toBe(403);
      expect(unverifiedSignIn.headers.get("Set-Cookie")).toBeNull();
      await expect(unverifiedSignIn.json()).resolves.toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });

      const verifyResponse = await auth.handler(new Request(verificationUrl));

      expect(verifyResponse.status).toBe(302);
      expect(verifyResponse.headers.get("Location")).toBe("/onboarding/student-id");
      expect((await prisma.user.findUnique({ where: { email } }))?.emailVerified).toBe(true);

      const verifiedSignIn = await signIn(email);
      expect(verifiedSignIn.ok).toBe(true);
      const cookie = cookieHeaderFrom(verifiedSignIn);
      expect(cookie).toBeTruthy();
      const verifiedSession = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(verifiedSession?.user.email).toBe(email);
      expect(verifiedSession?.user.emailVerified).toBe(true);
      const sessionToken = verifiedSession?.session.token;
      expect(sessionToken).toBeTruthy();

      // Revoke any session minted by the pre-verification deployment. Every
      // dashboard request resolves through this same Better Auth boundary.
      await prisma.user.update({ where: { email }, data: { emailVerified: false } });
      const dashboardSession = await getRequestSession(
        new Request("http://localhost/dashboard", { headers: { cookie } }),
      );
      expect(dashboardSession).toBeNull();
      if (sessionToken) {
        expect(await prisma.session.findUnique({ where: { token: sessionToken } })).toBeNull();
      }
    } finally {
      consoleSpy.mockRestore();
      if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = originalSmtpHost;
      resetMailerTransport();
    }
  });

  it("fails signup atomically when production has no SMTP transport", async () => {
    const email = `verify-no-smtp-${randomUUID().slice(0, 8)}@ubc.ca`;
    emails.push(email);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSmtpHost = process.env.SMTP_HOST;
    process.env.NODE_ENV = "production";
    delete process.env.SMTP_HOST;
    resetMailerTransport();

    try {
      const signupRequest = buildAuthSubRequest(
        "/api/auth/sign-up/email",
        new Request("http://localhost/auth/register"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "No SMTP Test",
            email,
            password: PASSWORD,
            callbackURL: "/onboarding/student-id",
          }),
        },
      );

      const signupResponse = await auth.handler(signupRequest);

      expect(signupResponse.ok).toBe(false);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = originalSmtpHost;
      resetMailerTransport();
    }
  });
});
