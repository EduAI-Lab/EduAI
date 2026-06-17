// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(),
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicies: vi.fn(),
  getPolicyDefinitions: vi.fn(),
  isPolicyKey: vi.fn(),
  setPolicy: vi.fn(),
}));

import { loader, action } from "~/routes/api/policies";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { getPolicies, getPolicyDefinitions, isPolicyKey, setPolicy } from "~/lib/policy.server";

const POLICIES = { "instructors.canCreateCourses": true };

function get(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/policies", { method: "GET", headers });
}
function patch(body: unknown) {
  return new Request("http://localhost/api/policies", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPolicies).mockResolvedValue(POLICIES as any);
  vi.mocked(getPolicyDefinitions).mockReturnValue([]);
  vi.mocked(isPolicyKey).mockReturnValue(true);
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
});

describe("GET /api/policies", () => {
  it("returns policies for a valid service key (Bearer)", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(null); // valid
    const res = await loader({ request: get({ Authorization: "Bearer key" }) } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policies: POLICIES });
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid service key with the guard's response", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await loader({ request: get({ Authorization: "Bearer bad" }) } as any);
    expect(res.status).toBe(403);
  });

  it("returns policies + definitions for an ADMIN session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as any);
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("policies");
    expect(body).toHaveProperty("definitions");
  });

  it("forbids a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(403);
  });

  it("401s an anonymous request", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/policies", () => {
  it("toggles a flag for an ADMIN and returns the updated policies", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as any);
    const res = await action({ request: patch({ key: "instructors.canCreateCourses", value: false }) } as any);
    expect(res.status).toBe(200);
    expect(setPolicy).toHaveBeenCalledWith("instructors.canCreateCourses", false, "a1");
  });

  it("forbids a non-admin", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await action({ request: patch({ key: "instructors.canCreateCourses", value: false }) } as any);
    expect(res.status).toBe(403);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it("404s an unknown policy key", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as any);
    vi.mocked(isPolicyKey).mockReturnValue(false);
    const res = await action({ request: patch({ key: "bogus", value: true }) } as any);
    expect(res.status).toBe(404);
  });

  it("405s a non-PATCH method", async () => {
    const res = await action({ request: get() } as any);
    expect(res.status).toBe(405);
  });
});
