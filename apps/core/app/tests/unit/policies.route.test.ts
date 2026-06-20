// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireAdmin: vi.fn(),
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
import { requireAdmin, requireServiceKey } from "~/lib/auth/guards.server";
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
  vi.mocked(requireAdmin).mockResolvedValue({ response: null, session: { user: { id: "a1", role: "ADMIN" } } } as any);
});

describe("GET /api/policies", () => {
  it("returns policies for a valid service key (Bearer, no user session)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null); // server-to-server, no session
    vi.mocked(requireServiceKey).mockResolvedValue(null); // valid
    const res = await loader({ request: get({ Authorization: "Bearer key" }) } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policies: POLICIES });
  });

  it("rejects an invalid service key with the guard's response (no user session)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await loader({ request: get({ Authorization: "Bearer bad" }) } as any);
    expect(res.status).toBe(403);
  });

  it("serves a logged-in user their policy values even when a stray Bearer header is present (not diverted to the service-key path)", async () => {
    // A proxy/SDK may attach an Authorization: Bearer header to a real user
    // request; it must NOT route them through requireServiceKey and 403 them.
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await loader({ request: get({ Authorization: "Bearer not-the-service-key" }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("policies");
    expect(body).not.toHaveProperty("definitions");
    expect(requireServiceKey).not.toHaveBeenCalled();
  });

  it("returns policies + definitions for an ADMIN session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as any);
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("policies");
    expect(body).toHaveProperty("definitions");
  });

  it("returns policy values (no definitions) for a non-admin session", async () => {
    // Non-admins may read flag VALUES so the client can mirror backend gates;
    // only ADMIN receives the toggle DEFINITIONS for the settings UI.
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("policies");
    expect(body).not.toHaveProperty("definitions");
  });

  it("401s an anonymous request (no session, no service key)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    // With no user session and no Bearer key, the service-key guard returns 401.
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), { status: 401 }),
    );
    const res = await loader({ request: get() } as any);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/policies", () => {
  it("toggles a flag for an ADMIN and returns the updated policies", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ response: null, session: { user: { id: "a1", role: "ADMIN" } } } as any);
    const res = await action({ request: patch({ key: "instructors.canCreateCourses", value: false }) } as any);
    expect(res.status).toBe(200);
    expect(setPolicy).toHaveBeenCalledWith("instructors.canCreateCourses", false, "a1");
  });

  it("forbids a non-admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden: Admins only" }), { status: 403 }),
      session: null,
    } as any);
    const res = await action({ request: patch({ key: "instructors.canCreateCourses", value: false }) } as any);
    expect(res.status).toBe(403);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it("404s an unknown policy key", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ response: null, session: { user: { id: "a1", role: "ADMIN" } } } as any);
    vi.mocked(isPolicyKey).mockReturnValue(false);
    const res = await action({ request: patch({ key: "bogus", value: true }) } as any);
    expect(res.status).toBe(404);
  });

  it("405s a non-PATCH method", async () => {
    const res = await action({ request: get() } as any);
    expect(res.status).toBe(405);
  });
});
