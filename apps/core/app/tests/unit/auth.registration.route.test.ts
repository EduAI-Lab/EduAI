// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
}));

vi.mock("~/lib/canvas/onboarding.server", () => ({
  redirectToStudentIdOnboardingIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  validateRedirectUrl: vi.fn(() => "/dashboard"),
}));

import { loader as registerLoader, action as registerAction } from "~/routes/auth/register";
import { loader as loginLoader } from "~/routes/auth/login";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";

function args(url = "http://localhost/auth/register") {
  return { request: new Request(url), params: {}, context: {} as never };
}

function registerFormArgs(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return {
    request: new Request("http://localhost/auth/register", { method: "POST", body }),
    params: {},
    context: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

describe("auth.allowPublicRegistration — route loaders (§6b)", () => {
  it("register loader redirects to /auth/login when public registration is off", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await registerLoader(args());
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("Location")).toBe("/auth/login");
    expect(getPolicy).toHaveBeenCalledWith("auth.allowPublicRegistration");
  });

  it("register loader renders the form (no redirect) when registration is on", async () => {
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await registerLoader(args());
    expect(res).not.toBeInstanceOf(Response); // returns {} → renders the form
  });

  it("login loader passes allowRegistration=false through when off", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loginLoader(args("http://localhost/auth/login"));
    expect(res).toMatchObject({ allowRegistration: false });
  });

  it("login loader passes allowRegistration=true through when on", async () => {
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await loginLoader(args("http://localhost/auth/login"));
    expect(res).toMatchObject({ allowRegistration: true });
  });
});

describe("register action — UBC email gate (§567)", () => {
  const validFields = {
    name: "Ada Lovelace",
    email: "ada@ubc.ca",
    password: "Supersecret1!",
    confirmPassword: "Supersecret1!",
  };

  it("returns a field error for a non-UBC email without invoking the auth handler", async () => {
    const res = (await registerAction(
      registerFormArgs({ ...validFields, email: "ada@gmail.com" }),
    )) as { fieldErrors?: Record<string, string> };
    expect(res.fieldErrors?.email).toMatch(/UBC/i);
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("passes a UBC email through to the auth handler (no email field error)", async () => {
    vi.mocked(auth.handler).mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = (await registerAction(registerFormArgs(validFields))) as {
      fieldErrors?: Record<string, string>;
    };
    expect(res.fieldErrors?.email).toBeUndefined();
    expect(auth.handler).toHaveBeenCalledTimes(1);
  });
});
