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

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/auth/login";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { logSecurityEvent } from "~/lib/logging.server";

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
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(
      makeLoaderArgs("http://localhost/auth/login?redirect=/dashboard"),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
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
      forceReauth: false,
      showDemoLogin: false,
      demoPassword: null,
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

  it("redirects with forwarded cookies and logs LOGIN_SUCCESS on success", async () => {
    const authResponse = new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
      status: 200,
      headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
    });
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

  it("expires the HTTP host-only session cookie when COOKIE_DOMAIN is configured", async () => {
    process.env.COOKIE_DOMAIN = ".eduai.ok.ubc.ca";
    authServerMocks.authBaseURL = "http://localhost:3000";
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
      }),
    );

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toContain(
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(res.headers.get("Set-Cookie")).not.toMatch(
      /(?:^|,\s)__Secure-better-auth\.session_token=;/,
    );
  });

  it("expires the HTTPS host-only session cookie when COOKIE_DOMAIN is configured", async () => {
    process.env.COOKIE_DOMAIN = ".eduai.ok.ubc.ca";
    authServerMocks.authBaseURL = "https://app.eduai.ok.ubc.ca";
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1", role: "STUDENT" } }), {
        status: 200,
        headers: { "Set-Cookie": "__Secure-better-auth.session_token=abc; Path=/; Secure" },
      }),
    );

    const res = (await action(
      makeActionArgs({
        email: "a@ubc.ca",
        password: "correct-password-123",
        redirectTo: "/dashboard",
      }),
    )) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toContain(
      "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(res.headers.get("Set-Cookie")).not.toMatch(/(?:^|,\s)better-auth\.session_token=;/);
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
