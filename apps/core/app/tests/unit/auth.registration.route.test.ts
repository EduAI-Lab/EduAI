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
  it("register loader signals the invite-only state when public registration is off (#807)", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await registerLoader(args());
    // §807: no longer a redirect — the page renders an invite-only message.
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ registrationDisabled: true });
    expect(getPolicy).toHaveBeenCalledWith("auth.allowPublicRegistration");
  });

  it("register loader renders the form when registration is on", async () => {
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await registerLoader(args());
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ registrationDisabled: false });
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
