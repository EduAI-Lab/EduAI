// @vitest-environment node
// #1213 — auth/login.tsx loader + action. The auth bucket sits at 36% —
// this covers the redirect-when-signed-in gate, forceReauth bypass,
// allowRegistration policy passthrough, field validation, and the
// success/failure branches of the sign-in action.
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

const authServerMocks = vi.hoisted(() => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
  authBaseURL: "http://localhost:3000",
}));

vi.mock("~/lib/auth/server", () => ({
  get auth() {
    return authServerMocks.auth;
  },
  get authBaseURL() {
    return authServerMocks.authBaseURL;
  },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/lib/deployment-safety.server", () => ({
  getLocalSeedPassword: vi.fn(),
  isLocalDemoEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/auth/dev-quick-login.server", () => ({
  devQuickLoginOptions: vi.fn().mockReturnValue(null),
  resolveDevQuickLogin: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

// #1961: keep the real join-redirect parser; stub the course lookup and the
// pending-join store.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/courses/self-enrollment.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/self-enrollment.server")>();
  return { ...actual, describeSelfEnrollmentLinkForVisitor: vi.fn() };
});
vi.mock("~/lib/courses/pending-self-enrollment.server", () => ({
  redeemPendingSelfEnrollments: vi.fn().mockResolvedValue([]),
  rememberPendingSelfEnrollmentForEmail: vi.fn().mockResolvedValue(true),
}));

import { loader, action } from "~/routes/auth/login";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { logSecurityEvent } from "~/lib/logging.server";
import { devQuickLoginOptions, resolveDevQuickLogin } from "~/lib/auth/dev-quick-login.server";
import { describeSelfEnrollmentLinkForVisitor } from "~/lib/courses/self-enrollment.server";
import {
  redeemPendingSelfEnrollments,
  rememberPendingSelfEnrollmentForEmail,
} from "~/lib/courses/pending-self-enrollment.server";

const originalCookieDomain = process.env.COOKIE_DOMAIN;

function makeLoaderArgs(url = "http://localhost/auth/login") {
  return {
    request: new Request(url),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPolicy).mockResolvedValue(true);
  vi.mocked(redeemPendingSelfEnrollments).mockResolvedValue([]);
  vi.mocked(devQuickLoginOptions).mockReturnValue(null);
  delete process.env.COOKIE_DOMAIN;
  authServerMocks.authBaseURL = "http://localhost:3000";
});

afterEach(() => {
  if (originalCookieDomain === undefined) delete process.env.COOKIE_DOMAIN;
  else process.env.COOKIE_DOMAIN = originalCookieDomain;
});

describe("auth/login loader", () => {
  it("redirects an already-signed-in user to the redirect target", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", emailVerified: true },
    } as never);
    const res = (await loader(
      makeLoaderArgs("http://localhost/auth/login?redirect=/dashboard"),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("redirects an already-signed-in unverified user to email verification", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT", emailVerified: false },
    } as never);

    const result = (await loader(makeLoaderArgs())) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/auth/verify-email");
  });

  it("does not auto-redirect when force=1, even if signed in", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const result = await loader(makeLoaderArgs("http://localhost/auth/login?force=1"));
    expect(result).toMatchObject({ forceReauth: true });
  });

  it("falls back to /dashboard for an unsafe redirect target (open-redirect guard)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const result = (await loader(
      makeLoaderArgs("http://localhost/auth/login?redirect=https://evil.example.com"),
    )) as { redirectTo: string };
    expect(result.redirectTo).toBe("/dashboard");
  });

  it("returns allowRegistration from the policy gate", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({
      redirectTo: "/dashboard",
      allowRegistration: false,
      joining: null,
      registerHref: "/auth/register",
      registrationSubmitted: false,
      forceReauth: false,
      showDemoLogin: false,
      demoPassword: null,
      devQuickLogin: null,
    });
  });
});

describe("auth/login action", () => {
  it("returns fieldErrors for invalid input", async () => {
    const result = (await action(makeActionArgs({ email: "not-an-email", password: "" }))) as {
      fieldErrors?: Record<string, string>;
    };
    expect(result.fieldErrors).toBeTruthy();
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("returns HTTP 413 for an oversized declared form before auth parsing", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("email=a@ubc.ca"));
      },
    });
    const result = (await action({
      request: new Request("http://localhost/auth/login", {
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

  it("returns HTTP 413 for chunked overflow, cancels the source, and never double-reads it", async () => {
    const cancel = vi.fn();
    let index = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = index++ === 0 ? "x".repeat(64 * 1024) : "y";
          controller.enqueue(new TextEncoder().encode(chunk));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const formData = vi.fn(() => Promise.reject(new Error("formData must not be called")));
    const result = (await action({
      request: {
        url: "http://localhost/auth/login",
        method: "POST",
        headers: new Headers({ "Content-Type": "application/x-www-form-urlencoded" }),
        body,
        signal: new AbortController().signal,
        formData,
      } as unknown as Request,
      params: {},
      context: {} as never,
    } as never)) as Response;
    expect(result.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(formData).not.toHaveBeenCalled();
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("logs LOGIN_FAILED and returns a formError when the handler rejects", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid credentials" }), { status: 401 }),
    );
    const result = (await action(
      makeActionArgs({ email: "a@ubc.ca", password: "wrong-password-123" }),
    )) as { formError?: string };
    expect(result.formError).toBe("Invalid credentials");
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "LOGIN_FAILED", outcome: "FAILURE" }),
    );
  });

  it("redirects an unverified sign-in to the anonymous verification page", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }), {
        status: 403,
      }),
    );

    const result = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/auth/verify-email");
    expect(result.headers.get("Set-Cookie")).toBeNull();
    const signInRequest = vi.mocked(auth.handler).mock.calls[0][0] as Request;
    // #1961: the email lands where a waiting course join is reported; that page
    // carries on to onboarding when there is none.
    expect(await signInRequest.json()).toEqual({
      email: "a@ubc.ca",
      password: "correct-password-123",
      callbackURL: "/courses/self-enroll/complete",
    });
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "LOGIN_FAILED", outcome: "FAILURE" }),
    );
  });

  it("redirects with forwarded cookies and logs LOGIN_SUCCESS on success", async () => {
    const authResponse = new Response(
      JSON.stringify({ user: { id: "u1", role: "STUDENT", emailVerified: true } }),
      {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
      },
    );
    vi.mocked(auth.handler).mockResolvedValue(authResponse);

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(res.headers.get("Set-Cookie")).toContain("better-auth.session=abc");
    expect(res.headers.get("Set-Cookie")).not.toMatch(/(?:^|,\s)better-auth\.session_token=;/);
    expect(res.headers.get("Set-Cookie")).not.toMatch(
      /(?:^|,\s)__Secure-better-auth\.session_token=;/,
    );
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        entityId: "u1",
      }),
    );
  });

  it("expires every legacy cookie scope when issuing a shared-domain session", async () => {
    process.env.COOKIE_DOMAIN = ".ok.ubc.ca";
    authServerMocks.authBaseURL = "https://my.eduai.ok.ubc.ca";
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=fresh; Domain=.ok.ubc.ca; Path=/",
        },
      }),
    );

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;
    const cookies = res.headers.getSetCookie();

    expect(cookies).toContain(
      "__Secure-better-auth.session_token=fresh; Domain=.ok.ubc.ca; Path=/",
    );
    expect(cookies).toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(cookies).toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=my.eduai.ok.ubc.ca",
    );
    // The intermediate scope from before COOKIE_DOMAIN widened from
    // `.eduai.ok.ubc.ca` to `.ok.ubc.ca` — a browser that still holds that
    // cookie sends it alongside the fresh one, and the server cannot tell
    // which the browser will list first.
    expect(cookies).toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.eduai.ok.ubc.ca",
    );
    // Must NOT re-expire the domain we just issued the fresh session on.
    expect(cookies).not.toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.ok.ubc.ca",
    );
  });

  it("expires the broader legacy scope when COOKIE_DOMAIN rolls back", async () => {
    process.env.COOKIE_DOMAIN = ".eduai.ok.ubc.ca";
    authServerMocks.authBaseURL = "https://my.eduai.ok.ubc.ca";
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
        status: 200,
        headers: {
          "Set-Cookie": "__Secure-better-auth.session_token=fresh; Domain=.eduai.ok.ubc.ca; Path=/",
        },
      }),
    );

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;
    const cookies = res.headers.getSetCookie();

    expect(cookies).toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.ok.ubc.ca",
    );
    expect(cookies).not.toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.eduai.ok.ubc.ca",
    );
  });

  it("does not expire the session cookie for loopback COOKIE_DOMAIN", async () => {
    process.env.COOKIE_DOMAIN = "localhost";
    authServerMocks.authBaseURL = "http://localhost:3000";
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session_token=fresh; Path=/" },
      }),
    );

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;

    expect(res.headers.getSetCookie()).not.toContain(
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
  });

  it("catches a thrown error from the handler and returns a formError", async () => {
    vi.mocked(auth.handler).mockRejectedValue(new Error("network down"));
    const result = (await action(
      makeActionArgs({ email: "a@ubc.ca", password: "correct-password-123" }),
    )) as { formError?: string };
    expect(result.formError).toBe("network down");
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "LOGIN_FAILED" }),
    );
  });
});

const JOIN_REDIRECT = "/courses/self-enroll?token=tok-1";

type LoginJoinData = {
  joining: { courseCode: string; courseName: string } | null;
  registerHref: string;
};

describe("auth/login loader — a course join link (#1961)", () => {
  it("names the course and carries the link into Sign up", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(describeSelfEnrollmentLinkForVisitor).mockResolvedValue({
      courseCode: "PSYO 121",
      courseName: "Introductory Psychology",
    });

    const data = (await loader(
      makeLoaderArgs(`http://localhost/auth/login?redirect=${encodeURIComponent(JOIN_REDIRECT)}`),
    )) as LoginJoinData;

    expect(describeSelfEnrollmentLinkForVisitor).toHaveBeenCalledWith("tok-1");
    expect(data.joining).toEqual({
      courseCode: "PSYO 121",
      courseName: "Introductory Psychology",
    });
    expect(data.registerHref).toBe(`/auth/register?redirect=${encodeURIComponent(JOIN_REDIRECT)}`);
  });

  it("looks nothing up for an ordinary sign-in", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const data = (await loader(makeLoaderArgs())) as LoginJoinData;

    expect(data.joining).toBeNull();
    expect(data.registerHref).toBe("/auth/register");
    expect(describeSelfEnrollmentLinkForVisitor).not.toHaveBeenCalled();
  });
});

describe("auth/login action — joins that waited for activation (#1961)", () => {
  const CREDENTIALS = { email: "a@ubc.ca", password: "correct-password-123" };

  function signedIn() {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT", emailVerified: true } }), {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
      }),
    );
  }

  it("lands on the join outcome when this sign-in finished a waiting join", async () => {
    signedIn();
    vi.mocked(redeemPendingSelfEnrollments).mockResolvedValue([
      { linkId: "link-1", outcome: "JOINED" },
    ]);

    const res = (await action(
      makeActionArgs({ ...CREDENTIALS, redirectTo: "/dashboard" }),
    )) as Response;

    expect(redeemPendingSelfEnrollments).toHaveBeenCalledWith(
      { id: "u1", role: "STUDENT" },
      expect.any(Request),
    );
    expect(res.headers.get("Location")).toBe("/courses/self-enroll/complete");
    expect(res.headers.get("Set-Cookie")).toContain("better-auth.session=abc");
  });

  it("goes where it was going when nothing was waiting", async () => {
    signedIn();

    const res = (await action(
      makeActionArgs({ ...CREDENTIALS, redirectTo: "/dashboard" }),
    )) as Response;

    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("still goes to an explicit destination, such as another join link, after settling a waiting join", async () => {
    signedIn();
    vi.mocked(redeemPendingSelfEnrollments).mockResolvedValue([
      { linkId: "link-1", outcome: "LINK_REVOKED" },
    ]);

    const res = (await action(
      makeActionArgs({ ...CREDENTIALS, redirectTo: JOIN_REDIRECT }),
    )) as Response;

    expect(redeemPendingSelfEnrollments).toHaveBeenCalled();
    expect(res.headers.get("Location")).toBe(JOIN_REDIRECT);
  });

  it("points the verification email at the landing page whether or not this sign-in came from a join link", async () => {
    signedIn();

    await action(makeActionArgs({ ...CREDENTIALS, redirectTo: "/dashboard" }));
    await action(makeActionArgs({ ...CREDENTIALS, redirectTo: JOIN_REDIRECT }));

    for (const [signIn] of vi.mocked(auth.handler).mock.calls) {
      expect((await (signIn as Request).json()).callbackURL).toBe("/courses/self-enroll/complete");
    }
  });

  it("remembers the join for an account refused only as unverified", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ code: "EMAIL_NOT_VERIFIED" }), { status: 403 }),
    );

    const res = (await action(
      makeActionArgs({ ...CREDENTIALS, redirectTo: JOIN_REDIRECT }),
    )) as Response;

    expect(res.headers.get("Location")).toBe("/auth/verify-email");
    expect(rememberPendingSelfEnrollmentForEmail).toHaveBeenCalledWith({
      email: "a@ubc.ca",
      token: "tok-1",
    });
  });

  it("remembers nothing for an unverified sign-in that did not come from a join link", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ code: "EMAIL_NOT_VERIFIED" }), { status: 403 }),
    );

    await action(makeActionArgs({ ...CREDENTIALS, redirectTo: "/dashboard" }));

    expect(rememberPendingSelfEnrollmentForEmail).not.toHaveBeenCalled();
  });

  it("remembers nothing on a wrong password", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(
        JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
        { status: 401 },
      ),
    );

    await action(makeActionArgs({ ...CREDENTIALS, redirectTo: JOIN_REDIRECT }));

    expect(rememberPendingSelfEnrollmentForEmail).not.toHaveBeenCalled();
  });
});

describe("auth/login — dev quick login (#1900)", () => {
  it("offers the dev buttons as keys and labels only, never a password", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(devQuickLoginOptions).mockReturnValue([
      { key: "student", label: "Student" },
      { key: "instructor", label: "Instructor" },
    ]);
    const data = (await loader(makeLoaderArgs())) as { devQuickLogin: unknown };
    expect(data.devQuickLogin).toEqual([
      { key: "student", label: "Student" },
      { key: "instructor", label: "Instructor" },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/password":"[^"]+/);
  });

  it("signs in with the server's credentials for a button that names only an account", async () => {
    vi.mocked(resolveDevQuickLogin).mockResolvedValue({
      ok: true,
      email: "student1@eduai.local",
      password: "server-held-password",
    });
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "s1", role: "STUDENT", emailVerified: true } }), {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
      }),
    );

    const res = (await action(
      makeActionArgs({ devQuickLogin: "student", redirectTo: "/dashboard" }),
    )) as Response;

    expect(resolveDevQuickLogin).toHaveBeenCalledWith("student");
    expect(res.status).toBe(302);
    const sent = await vi.mocked(auth.handler).mock.calls[0][0].json();
    expect(sent).toMatchObject({ email: "student1@eduai.local", password: "server-held-password" });
  });

  it("refuses without reaching sign-in when the server won't allow it", async () => {
    vi.mocked(resolveDevQuickLogin).mockResolvedValue({
      ok: false,
      error: "Quick login is never available for admin accounts.",
    });
    const result = await action(
      makeActionArgs({ devQuickLogin: "admin", redirectTo: "/dashboard" }),
    );
    expect(result).toEqual({ formError: "Quick login is never available for admin accounts." });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("ignores quick login on an ordinary sign-in", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT", emailVerified: true } }), {
        status: 200,
      }),
    );
    await action(makeActionArgs({ email: "a@ubc.ca", password: "correct-password-123" }));
    expect(resolveDevQuickLogin).not.toHaveBeenCalled();
  });
});
