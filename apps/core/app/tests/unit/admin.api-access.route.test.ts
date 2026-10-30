// @vitest-environment node
// Admin API for granting and revoking API access (#2039).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createApiAccessGrant: vi.fn(),
  listApiAccessGrants: vi.fn(),
  revokeApiAccessGrant: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock("~/lib/api-keys/access-grants.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api-keys/access-grants.server")>();
  return {
    ...actual,
    createApiAccessGrant: mocks.createApiAccessGrant,
    listApiAccessGrants: mocks.listApiAccessGrants,
    revokeApiAccessGrant: mocks.revokeApiAccessGrant,
  };
});

vi.mock("~/lib/prisma.server", () => ({ default: {} }));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/admin/api-access" })),
}));

import type { RouteRequestBody } from "../helpers/route-fixtures";
import { ApiAccessGrantError } from "~/lib/api-keys/access-grants.server";
import { action, loader } from "~/routes/api/admin.api-access";

function makeArgs(
  method: string,
  { body, id, query = "" }: { body?: RouteRequestBody; id?: string; query?: string } = {},
) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const path = id ? `/api/admin/api-access/${id}` : "/api/admin/api-access";
  return {
    request: new Request(`http://localhost${path}${query}`, init),
    params: id ? { id } : {},
    context: {} as never,
  } as never;
}

const grant = {
  id: "g1",
  userId: "s1",
  purpose: "Honours project",
  expiresAt: new Date("2026-12-31T00:00:00Z"),
  dailyRequestLimit: 200,
  dailyTokenLimit: 200_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    response: null,
    session: { user: { id: "admin-1", role: "ADMIN" } },
  });
  mocks.listApiAccessGrants.mockResolvedValue([]);
  mocks.createApiAccessGrant.mockResolvedValue(grant);
  mocks.revokeApiAccessGrant.mockResolvedValue({ ...grant, revokedAt: new Date() });
});

describe("admin API access API", () => {
  it("refuses non-admins", async () => {
    mocks.requireAdmin.mockResolvedValue({
      response: new Response(null, { status: 403 }),
      session: null,
    });
    expect((await loader(makeArgs("GET"))).status).toBe(403);
    expect((await action(makeArgs("POST", { body: {} }))).status).toBe(403);
    expect(mocks.createApiAccessGrant).not.toHaveBeenCalled();
  });

  it("lists active grants, or all with ?all=1", async () => {
    const res = await loader(makeArgs("GET"));
    await expect(res.json()).resolves.toMatchObject({
      grants: [],
      defaults: { dailyRequestLimit: 200, dailyTokenLimit: 500_000 },
    });
    expect(mocks.listApiAccessGrants).toHaveBeenCalledWith({ includeInactive: false });
    await loader(makeArgs("GET", { query: "?all=1" }));
    expect(mocks.listApiAccessGrants).toHaveBeenLastCalledWith({ includeInactive: true });
  });

  it("grants access with the default limits, recorded against the admin, and audits it", async () => {
    const res = await action(
      makeArgs("POST", {
        body: { userId: "s1", purpose: " Honours project ", expiresAt: "2026-12-31T00:00:00Z" },
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.createApiAccessGrant).toHaveBeenCalledWith({
      userId: "s1",
      purpose: "Honours project",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
      dailyRequestLimit: 200,
      dailyTokenLimit: 500_000,
      grantedById: "admin-1",
    });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "API_ACCESS_GRANTED", category: "SECURITY" }),
    );
  });

  it.each([
    ["no purpose", { userId: "s1", purpose: "", expiresAt: "2026-12-31" }],
    ["no end date", { userId: "s1", purpose: "x" }],
    [
      "a limit over the cap",
      { userId: "s1", purpose: "x", expiresAt: "2026-12-31", dailyRequestLimit: 999_999 },
    ],
  ])("rejects a grant with %s", async (_label, body) => {
    const res = await action(makeArgs("POST", { body }));
    expect(res.status).toBe(400);
    expect(mocks.createApiAccessGrant).not.toHaveBeenCalled();
  });

  it("passes on a grant refusal with its status", async () => {
    mocks.createApiAccessGrant.mockRejectedValue(
      new ApiAccessGrantError("This user already has API access", 409),
    );
    const res = await action(
      makeArgs("POST", { body: { userId: "s1", purpose: "x", expiresAt: "2026-12-31" } }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "This user already has API access" });
  });

  it("revokes a grant and audits it", async () => {
    const res = await action(makeArgs("DELETE", { id: "g1" }));
    expect(res.status).toBe(200);
    expect(mocks.revokeApiAccessGrant).toHaveBeenCalledWith("g1", "admin-1");
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "API_ACCESS_REVOKED", entityId: "g1" }),
    );
  });

  it("answers 405 for other methods", async () => {
    expect((await action(makeArgs("PUT", { body: {} }))).status).toBe(405);
    expect((await action(makeArgs("DELETE"))).status).toBe(405);
  });
});
