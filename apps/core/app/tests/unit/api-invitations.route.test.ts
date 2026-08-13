// @vitest-environment node
// #1213 — GET/POST /api/invitations: requireInviter gate, the ADMIN-sees-all
// vs UNIT_ADMIN-sees-own scoping, role-restriction on create, and the
// authorizedUnits validation branch.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/guards.server", () => ({
  requireInviter: vi.fn(),
}));

vi.mock("~/lib/invitations/service.server", () => ({
  listInvitations: vi.fn().mockResolvedValue([]),
  createInvitation: vi.fn(),
}));

vi.mock("~/lib/disciplines/guards.server", () => ({
  assertValidUnits: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/invitations";
import { requireInviter } from "~/lib/auth/guards.server";
import { listInvitations, createInvitation } from "~/lib/invitations/service.server";
import { assertValidUnits } from "~/lib/disciplines/guards.server";

function makeLoaderArgs() {
  return {
    request: new Request("http://localhost/api/invitations"),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "POST") {
  return {
    request: new Request("http://localhost/api/invitations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertValidUnits).mockResolvedValue(null);
});

describe("GET /api/invitations", () => {
  it("returns the gate's response when denied", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: new Response(null, { status: 401 }),
    } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("lists all invitations for an ADMIN", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN" } },
    } as never);
    await loader(makeLoaderArgs());
    expect(listInvitations).toHaveBeenCalledWith(undefined);
  });

  it("scopes to invitedById for a UNIT_ADMIN", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "ua-1", role: "UNIT_ADMIN" } },
    } as never);
    await loader(makeLoaderArgs());
    expect(listInvitations).toHaveBeenCalledWith({ invitedById: "ua-1" });
  });
});

describe("POST /api/invitations (action)", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeActionArgs({}, "DELETE"));
    expect(res.status).toBe(405);
    expect(requireInviter).not.toHaveBeenCalled();
  });

  it("returns the gate's response when denied", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: new Response(null, { status: 403 }),
    } as never);
    const res = await action(makeActionArgs({}));
    expect(res.status).toBe(403);
  });

  it("returns 422 for a schema-invalid body", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN", name: "Admin" } },
    } as never);
    const res = await action(makeActionArgs({ email: "not-an-email" }));
    expect(res.status).toBe(422);
  });

  it("returns 403 FORBIDDEN_ROLE when the actor can't invite that role", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "ua-1", role: "UNIT_ADMIN", name: "UA" } },
    } as never);
    const res = await action(makeActionArgs({ email: "new@student.ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("FORBIDDEN_ROLE");
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("validates authorizedUnits and returns the guard's response on failure", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN", name: "Admin" } },
    } as never);
    vi.mocked(assertValidUnits).mockResolvedValue(new Response(null, { status: 400 }) as never);
    const res = await action(
      makeActionArgs({ email: "new@student.ubc.ca", role: "UNIT_ADMIN", authorizedUnits: ["BOGUS"] }),
    );
    expect(res.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns a mapped error status when createInvitation fails", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN", name: "Admin" } },
    } as never);
    vi.mocked(createInvitation).mockResolvedValue({ ok: false, error: "USER_EXISTS", status: 409 } as never);
    const res = await action(makeActionArgs({ email: "existing@student.ubc.ca", role: "INSTRUCTOR" }));
    expect(res.status).toBe(409);
  });

  it("creates the invitation and returns 201 on success", async () => {
    vi.mocked(requireInviter).mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN", name: "Admin" } },
    } as never);
    vi.mocked(createInvitation).mockResolvedValue({
      ok: true,
      invitation: { id: "inv-1", email: "new@student.ubc.ca", role: "INSTRUCTOR" },
      acceptUrl: "https://example.com/accept",
      emailDelivered: true,
    } as never);

    const res = await action(makeActionArgs({ email: "new@student.ubc.ca", role: "INSTRUCTOR" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.id).toBe("inv-1");
  });
});
