/**
 * #1961 — a course join link survives sign-up and email verification, against
 * real Postgres and the real Better Auth handler.
 *
 * SMTP is unset, so the verification email is printed via `console.info` (as
 * in email-verification.integration.test.ts) and its link is opened through
 * `auth.handler`, which runs the real `afterEmailVerification` hook.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { auth } from "~/lib/auth/server";
import {
  createSelfEnrollmentLink,
  redeemSelfEnrollmentLink,
  revokeSelfEnrollmentLink,
} from "~/lib/courses/self-enrollment.server";
import { resetMailerTransport } from "~/lib/email/mailer.server";
import prisma from "~/lib/prisma.server";
import { action as loginAction } from "~/routes/auth/login";
import { action as registerAction } from "~/routes/auth/register";
import { loader as completeLoader } from "~/routes/courses.self-enroll.complete";

const PASSWORD = "Str0ng!Passw0rd-1961";
const suffix = randomUUID().slice(0, 8);
const emails: string[] = [];
let courseId = "";
let instructorId = "";
let consoleSpy: MockInstance<typeof console.info>;
let originalSmtpHost: string | undefined;

function postForm(url: string, values: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
}

function routeArgs(request: Request) {
  return { request, params: {}, context: {} as never } as never;
}

async function mintLink(maxRedemptions?: number) {
  const minted = await createSelfEnrollmentLink({
    courseId,
    createdById: instructorId,
    maxRedemptions,
  });
  if (minted.status !== "201") throw new Error(`mint failed: ${minted.error}`);
  return { token: minted.token, linkId: minted.link.id };
}

async function registerThroughLink(token: string) {
  const email = `join-${randomUUID().slice(0, 8)}@student.ubc.ca`;
  emails.push(email);
  const res = (await registerAction(
    routeArgs(
      postForm("http://localhost/auth/register", {
        name: "Join Student",
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        redirectTo: `/courses/self-enroll?token=${token}`,
      }),
    ),
  )) as Response;
  expect(res.headers.get("Location")).toBe(
    `/auth/login?registered=1&redirect=${encodeURIComponent(`/courses/self-enroll?token=${token}`)}`,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, user };
}

/** The link in the most recent verification email sent to this address. */
function verificationUrlFor(email: string): string {
  const message = consoleSpy.mock.calls
    .map(([logged]) => String(logged))
    .filter((logged) => logged.includes(email))
    .at(-1);
  const url = message?.match(/https?:\/\/\S+\/verify-email\?\S+/)?.[0];
  if (!url) throw new Error(`no verification email for ${email}`);
  return url;
}

function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function landingAs(cookie: string) {
  return completeLoader(
    routeArgs(
      new Request("http://localhost/courses/self-enroll/complete", { headers: { cookie } }),
    ),
  );
}

function enrollmentOf(userId: string) {
  return prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
}

async function outcomeOf(userId: string) {
  const row = await prisma.pendingSelfEnrollment.findFirstOrThrow({ where: { userId } });
  return row.outcome;
}

beforeAll(async () => {
  const instructor = await prisma.user.create({
    data: {
      email: `instr-1961-${suffix}@ubc.ca`,
      name: "Join Instructor",
      role: "INSTRUCTOR",
      emailVerified: true,
    },
  });
  instructorId = instructor.id;
  const course = await prisma.course.create({
    data: {
      code: `J1961 ${suffix}`,
      name: "Join After Signup",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01T12:00:00Z"),
      isPublished: true,
    },
  });
  courseId = course.id;
  await prisma.enrollment.create({
    data: { courseId, userId: instructorId, role: "INSTRUCTOR" },
  });
});

beforeEach(() => {
  originalSmtpHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  resetMailerTransport();
  consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
  if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = originalSmtpHost;
  resetMailerTransport();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: instructorId } });
  await prisma.$disconnect();
});

describe("a course join link survives sign-up and email verification (#1961)", () => {
  it("enrolls the new student when they verify, and the landing page takes them to the course", async () => {
    const link = await mintLink();
    const { email, user } = await registerThroughLink(link.token);

    expect(await enrollmentOf(user.id)).toBeNull();
    const pending = await prisma.pendingSelfEnrollment.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(pending.linkId).toBe(link.linkId);
    expect(JSON.stringify(pending)).not.toContain(link.token);

    const verify = await auth.handler(new Request(verificationUrlFor(email)));

    expect(verify.headers.get("Location")).toBe("/courses/self-enroll/complete");
    expect((await enrollmentOf(user.id))?.role).toBe("STUDENT");
    const linkRow = await prisma.selfEnrollmentLink.findUniqueOrThrow({
      where: { id: link.linkId },
    });
    expect(linkRow.redemptionCount).toBe(1);
    expect(await outcomeOf(user.id)).toBe("JOINED");

    const landing = (await landingAs(cookieFrom(verify))) as Response;
    expect(landing.headers.get("Location")).toBe(
      `/onboarding/student-id?next=${encodeURIComponent(`/courses/${courseId}`)}`,
    );
  });

  it("does not enroll from a link revoked before verification, and says why", async () => {
    const link = await mintLink();
    const { email, user } = await registerThroughLink(link.token);
    await revokeSelfEnrollmentLink(courseId, link.linkId);

    const verify = await auth.handler(new Request(verificationUrlFor(email)));

    expect(await enrollmentOf(user.id)).toBeNull();
    expect(await outcomeOf(user.id)).toBe("LINK_REVOKED");
    expect(await landingAs(cookieFrom(verify))).toMatchObject({
      message: expect.stringMatching(/turned off/),
    });
  });

  it("does not enroll from a link that expired before verification, and says why", async () => {
    const link = await mintLink();
    const { email, user } = await registerThroughLink(link.token);
    await prisma.selfEnrollmentLink.update({
      where: { id: link.linkId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const verify = await auth.handler(new Request(verificationUrlFor(email)));

    expect(await enrollmentOf(user.id)).toBeNull();
    expect(await outcomeOf(user.id)).toBe("LINK_EXPIRED");
    expect(await landingAs(cookieFrom(verify))).toMatchObject({
      message: expect.stringMatching(/expired/),
    });
  });

  it("does not enroll past the cap when the link filled up meanwhile", async () => {
    const link = await mintLink(1);
    const { email, user } = await registerThroughLink(link.token);
    const other = await prisma.user.create({
      data: {
        email: `other-${randomUUID().slice(0, 8)}@student.ubc.ca`,
        name: "Other Student",
        role: "STUDENT",
        emailVerified: true,
      },
    });
    emails.push(other.email);
    const taken = await redeemSelfEnrollmentLink({ token: link.token, userId: other.id });
    expect(taken.status).toBe("201");

    await auth.handler(new Request(verificationUrlFor(email)));

    expect(await enrollmentOf(user.id)).toBeNull();
    expect(await outcomeOf(user.id)).toBe("LINK_EXHAUSTED");
    const linkRow = await prisma.selfEnrollmentLink.findUniqueOrThrow({
      where: { id: link.linkId },
    });
    expect(linkRow.redemptionCount).toBe(1);
  });

  it("finishes the join at first sign-in when the account was activated without the hook", async () => {
    const link = await mintLink();
    const { email, user } = await registerThroughLink(link.token);
    // As where verification is off: the account is active, but no verification ran.
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });

    const res = (await loginAction(
      routeArgs(
        postForm("http://localhost/auth/login", {
          email,
          password: PASSWORD,
          redirectTo: "/dashboard",
        }),
      ),
    )) as Response;

    expect(res.headers.get("Location")).toBe("/courses/self-enroll/complete");
    expect((await enrollmentOf(user.id))?.role).toBe("STUDENT");
  });

  it("remembers nothing when a join-link sign-up uses an email that already has an account", async () => {
    const link = await mintLink();
    const email = `taken-${randomUUID().slice(0, 8)}@student.ubc.ca`;
    emails.push(email);
    await auth.handler(
      buildAuthSubRequest(
        "/api/auth/sign-up/email",
        new Request("http://localhost/auth/register"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "First Owner",
            email,
            password: PASSWORD,
            callbackURL: "/onboarding/student-id",
          }),
        },
      ),
    );
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    // Better Auth answers this second sign-up with a stand-in user, not an error.
    const res = (await registerAction(
      routeArgs(
        postForm("http://localhost/auth/register", {
          name: "Someone Else",
          email,
          password: "An0ther!Passw0rd",
          confirmPassword: "An0ther!Passw0rd",
          redirectTo: `/courses/self-enroll?token=${link.token}`,
        }),
      ),
    )) as Response;

    expect(res.headers.get("Location")).toBe(
      `/auth/login?registered=1&redirect=${encodeURIComponent(`/courses/self-enroll?token=${link.token}`)}`,
    );
    expect(await prisma.pendingSelfEnrollment.count({ where: { userId: owner.id } })).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();

    // The preserved link only attaches to the real account after its owner
    // proves the password. Verifying then completes the join as usual.
    await loginAction(
      routeArgs(
        postForm("http://localhost/auth/login", {
          email,
          password: PASSWORD,
          redirectTo: `/courses/self-enroll?token=${link.token}`,
        }),
      ),
    );
    expect(await prisma.pendingSelfEnrollment.count({ where: { userId: owner.id } })).toBe(1);
    const verify = await auth.handler(new Request(verificationUrlFor(email)));
    expect((await enrollmentOf(owner.id))?.role).toBe("STUDENT");
    expect(await outcomeOf(owner.id)).toBe("JOINED");
    const landing = (await landingAs(cookieFrom(verify))) as Response;
    expect(landing.headers.get("Location")).toBe(
      `/onboarding/student-id?next=${encodeURIComponent(`/courses/${courseId}`)}`,
    );
  });

  it("remembers a join for an existing unverified account at a blocked sign-in; verifying redeems it", async () => {
    const link = await mintLink();
    const email = `unverified-${randomUUID().slice(0, 8)}@student.ubc.ca`;
    emails.push(email);
    const signedUp = await auth.handler(
      buildAuthSubRequest(
        "/api/auth/sign-up/email",
        new Request("http://localhost/auth/register"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Late Student",
            email,
            password: PASSWORD,
            callbackURL: "/onboarding/student-id",
          }),
        },
      ),
    );
    expect(signedUp.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const joinRedirect = `/courses/self-enroll?token=${link.token}`;

    const wrong = (await loginAction(
      routeArgs(
        postForm("http://localhost/auth/login", {
          email,
          password: "Wrong-Passw0rd!",
          redirectTo: joinRedirect,
        }),
      ),
    )) as { formError?: string };
    expect(wrong.formError).toBeTruthy();
    expect(await prisma.pendingSelfEnrollment.count({ where: { userId: user.id } })).toBe(0);

    const blocked = (await loginAction(
      routeArgs(
        postForm("http://localhost/auth/login", {
          email,
          password: PASSWORD,
          redirectTo: joinRedirect,
        }),
      ),
    )) as Response;
    expect(blocked.headers.get("Location")).toBe("/auth/verify-email");
    expect(await prisma.pendingSelfEnrollment.count({ where: { userId: user.id } })).toBe(1);

    // The email Better Auth sent on that sign-in points at the landing page.
    const url = verificationUrlFor(email);
    expect(new URL(url).searchParams.get("callbackURL")).toBe("/courses/self-enroll/complete");
    await auth.handler(new Request(url));

    expect((await enrollmentOf(user.id))?.role).toBe("STUDENT");
  });
});
