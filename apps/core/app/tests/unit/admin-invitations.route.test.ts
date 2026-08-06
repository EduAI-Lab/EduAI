// @vitest-environment node
// #1213 — admin.invitations.tsx loader authz: unauthenticated → /auth/login,
// role outside {ADMIN, UNIT_ADMIN} → /dashboard, ADMIN/UNIT_ADMIN → loads
// with the roles they're each allowed to invite.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader } from "~/routes/admin.invitations";
import { auth } from "~/lib/auth/server";

function makeArgs() {
  return {
    request: new Request("http://localhost/admin/invitations"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.invitations loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects a STUDENT to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("redirects an INSTRUCTOR to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("loads for an ADMIN with all invitable roles", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "admin-1", role: "ADMIN" },
      invitableRoles: ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"],
    });
  });

  it("loads for a UNIT_ADMIN with a restricted invitable-role set", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    const result = (await loader(makeArgs())) as unknown as { invitableRoles: readonly string[] };
    expect(result.invitableRoles).not.toContain("ADMIN");
  });
});
