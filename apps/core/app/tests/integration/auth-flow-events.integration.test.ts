// #1942: a sign-up, a verification email and a password reset left nothing in
// Admin → Logs. They are recorded as security events from Better Auth's own
// hooks, so they fire only for real accounts and only once per real action.
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { auth } from "~/lib/auth/server";
import { resetMailerTransport } from "~/lib/email/mailer.server";
import prisma from "~/lib/prisma.server";

const PASSWORD = "Verification1!";
const NEW_PASSWORD = "Resetting2@Again";
const emails: string[] = [];
let originalSmtpHost: string | undefined;
let consoleInfo: MockInstance<typeof console.info>;

function authPost(path: string, from: string, body: Record<string, string>): Promise<Response> {
  return auth.handler(
    buildAuthSubRequest(path, new Request(`http://localhost${from}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function signUp(email: string): Promise<Response> {
  return authPost("/api/auth/sign-up/email", "/auth/register", {
    name: "Events Test",
    email,
    password: PASSWORD,
    callbackURL: "/onboarding/student-id",
  });
}

function requestReset(email: string): Promise<Response> {
  return authPost("/api/auth/email-otp/request-password-reset", "/auth/forgot-password", {
    email,
  });
}

async function securityEvents(email: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { category: "SECURITY", entityLabel: email },
    orderBy: { createdAt: "asc" },
    select: { actionCode: true },
  });
  return rows.map((row) => row.actionCode);
}

function newEmail(): string {
  const email = `events-${randomUUID().slice(0, 8)}@ubc.ca`;
  emails.push(email);
  return email;
}

beforeEach(() => {
  originalSmtpHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  resetMailerTransport();
  consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  consoleInfo.mockRestore();
  if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = originalSmtpHost;
  resetMailerTransport();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityLabel: { in: emails } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("sign-up and password-reset security events (#1942)", () => {
  it("records a sign-up and its verification email", async () => {
    const email = newEmail();

    expect((await signUp(email)).ok).toBe(true);

    // Both writes are fire-and-forget, so they may land in either order.
    await vi.waitFor(async () =>
      expect([...(await securityEvents(email))].sort()).toEqual([
        "USER_REGISTERED",
        "VERIFICATION_EMAIL_SENT",
      ]),
    );
  });

  it("does not record a second registration when the address already has an account", async () => {
    const email = newEmail();
    await signUp(email);
    await vi.waitFor(async () => expect(await securityEvents(email)).toContain("USER_REGISTERED"));

    await signUp(email);

    const events = await securityEvents(email);
    expect(events.filter((code) => code === "USER_REGISTERED")).toHaveLength(1);
  });

  it("records a reset request and its completion for an existing account", async () => {
    const email = newEmail();
    await signUp(email);

    expect((await requestReset(email)).ok).toBe(true);
    await vi.waitFor(async () =>
      expect(await securityEvents(email)).toContain("PASSWORD_RESET_REQUESTED"),
    );

    const otp = consoleInfo.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(email))
      .map((message) => message.match(/\b(\d{6})\b/)?.[1])
      .find(Boolean);
    if (!otp) throw new Error("Password reset email did not contain a code");

    const reset = await authPost("/api/auth/email-otp/reset-password", "/auth/reset-password", {
      email,
      otp,
      password: NEW_PASSWORD,
    });
    expect(reset.ok).toBe(true);

    await vi.waitFor(async () =>
      expect(await securityEvents(email)).toContain("PASSWORD_RESET_COMPLETED"),
    );
  });

  it("records nothing for a reset request against an unknown address", async () => {
    const email = newEmail();

    expect((await requestReset(email)).ok).toBe(true);

    // Give any fire-and-forget write time to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await securityEvents(email)).toEqual([]);
  });
});
