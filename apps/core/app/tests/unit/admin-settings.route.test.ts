// @vitest-environment node
// #1213 — admin.settings.tsx loader authz: unauthenticated → /auth/login,
// non-admin → /dashboard, ADMIN → loads (including environment health).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/environment-health.server", () => ({
  getEnvironmentHealth: vi.fn(() => ({ missingKeys: [] })),
}));

import { loader } from "~/routes/admin.settings";
import { auth } from "~/lib/auth/server";
import { getEnvironmentHealth } from "~/lib/environment-health.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/admin/settings"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.settings loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects a non-admin to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "UNIT_ADMIN" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("returns the session user and environment health for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(getEnvironmentHealth).mockReturnValue({ missingKeys: ["OPENAI_API_KEY"] } as never);

    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "admin-1", role: "ADMIN" },
      environmentHealth: { missingKeys: ["OPENAI_API_KEY"] },
    });
  });
});
