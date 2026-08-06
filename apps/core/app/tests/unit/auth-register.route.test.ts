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

import { loader, action } from "~/routes/auth/register";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";

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
  vi.mocked(getPolicy).mockResolvedValue(true);
  vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(null);
});

describe("auth/register loader", () => {
  it("redirects a signed-in user to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeLoaderArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("passes through the onboarding redirect for a signed-in user who needs it", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const onboardingRedirect = new Response(null, {
      status: 302,
      headers: { Location: "/onboarding/student-id" },
    });
    vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(onboardingRedirect as never);

    const result = await loader(makeLoaderArgs());
    expect(result).toBe(onboardingRedirect);
  });

  it("returns registrationDisabled:true when public registration is off (#807)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({ registrationDisabled: true });
  });

  it("returns registrationDisabled:false when public registration is on", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicy).mockResolvedValue(true);
    const result = await loader(makeLoaderArgs());
    expect(result).toEqual({ registrationDisabled: false });
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

  it("redirects to /onboarding/student-id with forwarded cookies on success", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session=abc; Path=/" },
      }),
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
    expect(res.headers.get("Location")).toBe("/onboarding/student-id");
    expect(res.headers.get("Set-Cookie")).toContain("better-auth.session=abc");
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
