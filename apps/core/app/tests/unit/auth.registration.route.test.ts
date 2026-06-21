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

import { loader as registerLoader } from "~/routes/auth/register";
import { loader as loginLoader } from "~/routes/auth/login";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";

function args(url = "http://localhost/auth/register") {
  return { request: new Request(url), params: {}, context: {} as never };
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
