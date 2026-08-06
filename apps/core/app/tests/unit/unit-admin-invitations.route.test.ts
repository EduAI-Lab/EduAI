// @vitest-environment node
// #1213 — unit-admin.invitations.tsx loader authz: unauthenticated →
// /auth/login, non-UNIT_ADMIN → /dashboard, policy-gated even for a
// UNIT_ADMIN (the whole surface doesn't exist when the flag is off).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
}));

import { loader } from "~/routes/unit-admin.invitations";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/unit-admin/invitations"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unit-admin.invitations loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("redirects an ADMIN (not UNIT_ADMIN) to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("redirects a UNIT_ADMIN to /dashboard when the invite policy is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(getPolicy).mockResolvedValue(false);

    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canInvite");
  });

  it("returns the session user for a UNIT_ADMIN when the policy is on", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(getPolicy).mockResolvedValue(true);

    const result = await loader(makeArgs());
    expect(result).toEqual({ user: { id: "ua-1", role: "UNIT_ADMIN" } });
  });
});
