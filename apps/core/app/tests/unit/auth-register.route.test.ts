// @vitest-environment node
// #1213 — auth/register.tsx loader + action: signed-in bounce (with
// onboarding passthrough), the #807 invite-only banner when public
// registration is off, field validation, and the sign-up success/failure
// branches.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/lib/canvas/onboarding.server", () => ({
  redirectToStudentIdOnboardingIfNeeded: vi.fn().mockResolvedValue(null),
}));

// #1961: keep the real join-redirect parser; stub the course lookup and the
// pending-join store.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/courses/self-enrollment.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/self-enrollment.server")>();
  return { ...actual, describeSelfEnrollmentLinkForVisitor: vi.fn() };
});
vi.mock("~/lib/courses/pending-self-enrollment.server", () => ({
  rememberPendingSelfEnrollmentForSignUp: vi.fn().mockResolvedValue(true),
  redeemPendingSelfEnrollments: vi.fn().mockResolvedValue([]),
}));

import { loader, action } from "~/routes/auth/register";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { describeSelfEnrollmentLinkForVisitor } from "~/lib/courses/self-enrollment.server";
import {
  redeemPendingSelfEnrollments,
  rememberPendingSelfEnrollmentForSignUp,
} from "~/lib/courses/pending-self-enrollment.server";

function makeLoaderArgs() {
  return {
    request: new Request("http://localhost/auth/register"),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rememberPendingSelfEnrollmentForSignUp).mockResolvedValue(true);
  vi.mocked(getPolicy).mockResolvedValue(true);
  vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(null);
});

describe("auth/register loader", () => {
  it("redirects a signed-in user to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", emailVerified: true },
    } as never);
    const res = (await loader(makeLoaderArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("passes through the onboarding redirect for a signed-in user who needs it", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", emailVerified: true },
    } as never);
    const onboardingRedirect = new Response(null, {
      status: 302,
      headers: { Location: "/onboarding/student-id" },
    });
    vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(onboardingRedirect as never);

    const result = await loader(makeLoaderArgs());
    expect(result).toBe(onboardingRedirect);
  });

  it("sends an unverified signed-in user to the verification page", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", emailVerified: false },
    } as never);

    const result = (await loader(makeLoaderArgs())) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/auth/verify-email");
    expect(redirectToStudentIdOnboardingIfNeeded).not.toHaveBeenCalled();
  });

  it("returns registrationDisabled:true when public registration is off (#807)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({ registrationDisabled: true, joining: null, redirectTo: "" });
  });

  it("returns registrationDisabled:false when public registration is on", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(true);
    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({ registrationDisabled: false, joining: null, redirectTo: "" });
  });
});

describe("auth/register action", () => {
  it("returns fieldErrors for a non-UBC email", async () => {
    const result = (await action(
      makeActionArgs({
        name: "Ada Lovelace",
        email: "ada@gmail.com",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as { fieldErrors?: Record<string, string> };
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("returns HTTP 413 for an oversized declared form before auth parsing", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("email=a@ubc.ca"));
      },
    });
    const result = (await action({
      request: new Request("http://localhost/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(64 * 1024 + 1),
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      params: {},
      context: {} as never,
    } as never)) as Response;
    expect(result.status).toBe(413);
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("returns fieldErrors when passwords don't match", async () => {
    const result = (await action(
      makeActionArgs({
        name: "Ada Lovelace",
        email: "ada@student.ubc.ca",
        password: STRONG_PASSWORD,
        confirmPassword: "different",
      }),
    )) as { fieldErrors?: Record<string, string> };
    expect(result.fieldErrors?.confirmPassword).toBeTruthy();
  });

  it("returns a formError when the handler rejects", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ error: "USER_EXISTS" }), { status: 409 }),
    );
    const result = (await action(
      makeActionArgs({
        name: "Ada Lovelace",
        email: "ada@student.ubc.ca",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as { formError?: string };
    expect(result.formError).toBe("USER_EXISTS");
  });

  it("requests verification and redirects without creating a signup session", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ token: null, user: { id: "u1" } }), { status: 200 }),
    );
    const res = (await action(
      makeActionArgs({
        name: "Ada Lovelace",
        email: "ada@student.ubc.ca",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/verify-email");
    expect(res.headers.get("Set-Cookie")).toBeNull();

    const signupRequest = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect(await signupRequest.json()).toEqual({
      name: "Ada Lovelace",
      email: "ada@student.ubc.ca",
      password: STRONG_PASSWORD,
      callbackURL: "/onboarding/student-id",
    });
  });

  it("catches a thrown error from the handler and returns a formError", async () => {
    vi.mocked(auth.handler).mockRejectedValue(new Error("network down"));
    const result = (await action(
      makeActionArgs({
        name: "Ada Lovelace",
        email: "ada@student.ubc.ca",
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
      }),
    )) as { formError?: string };
    expect(result.formError).toBe("network down");
  });
});

function makeLoaderArgsAt(url: string) {
  return { request: new Request(url), params: {}, context: {} as never } as never;
}

describe("auth/register loader — a course join link (#1961)", () => {
  it("names the course and keeps the link for the form", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(describeSelfEnrollmentLinkForVisitor).mockResolvedValue({
      courseCode: "PSYO 121",
      courseName: "Introductory Psychology",
    });

    const data = await loader(
      makeLoaderArgsAt(
        `http://localhost/auth/register?redirect=${encodeURIComponent("/courses/self-enroll?token=tok-1")}`,
      ),
    );

    expect(describeSelfEnrollmentLinkForVisitor).toHaveBeenCalledWith("tok-1");
    expect(data).toEqual({
      registrationDisabled: false,
      joining: { courseCode: "PSYO 121", courseName: "Introductory Psychology" },
      redirectTo: "/courses/self-enroll?token=tok-1",
    });
  });

  it("ignores a redirect that is not a join link", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const data = await loader(
      makeLoaderArgsAt("http://localhost/auth/register?redirect=%2Fdashboard"),
    );

    expect(data).toEqual({ registrationDisabled: false, joining: null, redirectTo: "" });
    expect(describeSelfEnrollmentLinkForVisitor).not.toHaveBeenCalled();
  });
});

describe("auth/register action — a course join link (#1961)", () => {
  const FORM = {
    name: "New Student",
    email: "new@student.ubc.ca",
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
  };

  it("points the verification email at the landing page and remembers the join for the new account", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ token: null, user: { id: "new-user" } }), { status: 200 }),
    );

    const res = (await action(
      makeActionArgs({ ...FORM, redirectTo: "/courses/self-enroll?token=tok-1" }),
    )) as Response;

    expect(res.headers.get("Location")).toBe(
      "/auth/login?registered=1&redirect=%2Fcourses%2Fself-enroll%3Ftoken%3Dtok-1",
    );
    const signup = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect((await signup.json()).callbackURL).toBe("/courses/self-enroll/complete");
    // The email goes along so the store can tell a new account from Better
    // Auth's stand-in for an email that is already taken.
    expect(rememberPendingSelfEnrollmentForSignUp).toHaveBeenCalledWith({
      userId: "new-user",
      email: "new@student.ubc.ca",
      token: "tok-1",
    });
  });

  it("remembers nothing for an ordinary sign-up, whose email still lands on onboarding", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ token: null, user: { id: "new-user" } }), { status: 200 }),
    );

    await action(makeActionArgs({ ...FORM, redirectTo: "/dashboard" }));

    const signup = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    expect((await signup.json()).callbackURL).toBe("/onboarding/student-id");
    expect(rememberPendingSelfEnrollmentForSignUp).not.toHaveBeenCalled();
  });

  it("remembers nothing when the sign-up itself failed", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ message: "User already exists" }), { status: 422 }),
    );

    const result = await action(
      makeActionArgs({ ...FORM, redirectTo: "/courses/self-enroll?token=tok-1" }),
    );

    expect(result).toEqual({ formError: "User already exists" });
    expect(rememberPendingSelfEnrollmentForSignUp).not.toHaveBeenCalled();
  });
});

describe("join signup review regressions", () => {
  const form = {
    name: "Join Student",
    email: "new@student.ubc.ca",
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    redirectTo: "/courses/self-enroll?token=tok-1",
  };
  it.each([true, false])(
    "preserves the join and all session cookies with pending join saved=%s",
    async (remembered) => {
      vi.mocked(rememberPendingSelfEnrollmentForSignUp).mockResolvedValue(remembered);
      const headers = new Headers();
      headers.append("Set-Cookie", "better-auth.session_token=session; Path=/; HttpOnly");
      headers.append("Set-Cookie", "better-auth.session_data=data; Path=/; HttpOnly");
      vi.mocked(auth.handler).mockResolvedValue(
        new Response(
          JSON.stringify({ token: "session", user: { id: "new-user", role: "STUDENT" } }),
          { headers },
        ),
      );
      const res = (await action(makeActionArgs(form))) as Response;
      expect(res.headers.get("Location")).toBe(
        remembered ? "/courses/self-enroll/complete" : "/courses/self-enroll?token=tok-1",
      );
      expect(res.headers.getSetCookie()).toEqual([
        "better-auth.session_token=session; Path=/; HttpOnly",
        "better-auth.session_data=data; Path=/; HttpOnly",
      ]);
      expect(redeemPendingSelfEnrollments).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])(
    "preserves the join through sign-in without exposing whether signup created an account: %s",
    async (remembered) => {
      vi.mocked(rememberPendingSelfEnrollmentForSignUp).mockResolvedValue(remembered);
      vi.mocked(auth.handler).mockResolvedValue(
        new Response(JSON.stringify({ token: null, user: { id: "stand-in-or-new" } })),
      );
      const res = (await action(makeActionArgs(form))) as Response;
      expect(res.headers.get("Location")).toBe(
        "/auth/login?registered=1&redirect=%2Fcourses%2Fself-enroll%3Ftoken%3Dtok-1",
      );
      expect(redeemPendingSelfEnrollments).not.toHaveBeenCalled();
    },
  );
});
