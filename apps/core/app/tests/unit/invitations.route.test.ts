// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/guards.server", () => ({
  requireInviter: vi.fn(),
}));

vi.mock("~/lib/invitations/service.server", () => ({
  createInvitation: vi.fn(),
  listInvitations: vi.fn().mockResolvedValue([]),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({})),
  getRequestContext: vi.fn(() => ({})),
}));

import { loader, action } from "~/routes/api/invitations";
import { action as idAction } from "~/routes/api/invitations.$id";
import { requireInviter } from "~/lib/auth/guards.server";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  resendInvitation,
} from "~/lib/invitations/service.server";

// The `unitAdmins.canInvite` flag gate now lives inside `requireInviter`, so the
// routes only ever see "admitted" or "denied". `asInviter` simulates an admitted
// actor; `forbiddenInviter` simulates any guard denial (wrong role OR flag off).
function asInviter(role: string, id = "me") {
  vi.mocked(requireInviter).mockResolvedValue({
    response: null,
    session: { user: { id, role, name: "Inviter" } },
  } as never);
}

function forbiddenInviter() {
  vi.mocked(requireInviter).mockResolvedValue({
    response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    session: null,
  } as never);
}

function getReq() {
  return { request: new Request("http://localhost/api/invitations") } as never;
}

function postReq(body: unknown) {
  return {
    request: new Request("http://localhost/api/invitations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  } as never;
}

function idReq(method: "DELETE" | "POST", id = "inv1") {
  return {
    request: new Request(`http://localhost/api/invitations/${id}`, { method }),
    params: { id },
  } as never;
}

const CREATED = {
  ok: true as const,
  invitation: { id: "inv1", email: "x@ubc.ca", role: "INSTRUCTOR" },
  acceptUrl: "http://localhost/auth/accept-invitation?token=t",
  emailDelivered: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listInvitations).mockResolvedValue([]);
  vi.mocked(createInvitation).mockResolvedValue(CREATED as never);
  vi.mocked(revokeInvitation).mockResolvedValue({ ok: true, invitation: CREATED.invitation } as never);
  vi.mocked(resendInvitation).mockResolvedValue(CREATED as never);
});

describe("GET /api/invitations", () => {
  it("surfaces the guard's 403 and does not list", async () => {
    forbiddenInviter();
    const res = await loader(getReq());
    expect(res.status).toBe(403);
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it("ADMIN lists all invitations (no scope)", async () => {
    asInviter("ADMIN", "a1");
    const res = await loader(getReq());
    expect(res.status).toBe(200);
    expect(listInvitations).toHaveBeenCalledWith(undefined);
  });

  it("UNIT_ADMIN sees only their own invitations", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await loader(getReq());
    expect(res.status).toBe(200);
    expect(listInvitations).toHaveBeenCalledWith({ invitedById: "me" });
  });
});

describe("POST /api/invitations", () => {
  it("ADMIN may invite an INSTRUCTOR (201)", async () => {
    asInviter("ADMIN", "a1");
    const res = await action(postReq({ email: "prof@ubc.ca", role: "INSTRUCTOR" }));
    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalled();
  });

  it("ADMIN may invite a STUDENT (201 — superset of lower roles)", async () => {
    asInviter("ADMIN", "a1");
    const res = await action(postReq({ email: "s@ubc.ca", role: "STUDENT" }));
    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalled();
  });

  it("rejects a non-UBC invite email at the schema (400, #567)", async () => {
    asInviter("ADMIN", "a1");
    const res = await action(postReq({ email: "prof@gmail.com", role: "INSTRUCTOR" }));
    expect(res.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("UNIT_ADMIN may invite an INSTRUCTOR", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await action(postReq({ email: "prof@ubc.ca", role: "INSTRUCTOR" }));
    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ role: "INSTRUCTOR" }),
      { id: "me", name: "Inviter" },
    );
  });

  it("UNIT_ADMIN may invite a STUDENT", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await action(postReq({ email: "s@ubc.ca", role: "STUDENT" }));
    expect(res.status).toBe(201);
  });

  it("UNIT_ADMIN may NOT invite an ADMIN (403 FORBIDDEN_ROLE)", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await action(postReq({ email: "boss@ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN_ROLE" });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("surfaces the guard's 403 before parsing the body or creating", async () => {
    forbiddenInviter();
    const res = await action(postReq({ email: "prof@ubc.ca", role: "INSTRUCTOR" }));
    expect(res.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });
});

describe("/api/invitations/:id (revoke/resend)", () => {
  it("ADMIN revokes with no ownership scope", async () => {
    asInviter("ADMIN", "a1");
    const res = await idAction(idReq("DELETE"));
    expect(res.status).toBe(200);
    expect(revokeInvitation).toHaveBeenCalledWith("inv1", undefined);
  });

  it("UNIT_ADMIN revoke is scoped to their own invitations", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await idAction(idReq("DELETE"));
    expect(res.status).toBe(200);
    expect(revokeInvitation).toHaveBeenCalledWith("inv1", { restrictToInviterId: "me" });
  });

  it("UNIT_ADMIN resend is scoped to their own invitations", async () => {
    asInviter("UNIT_ADMIN", "me");
    const res = await idAction(idReq("POST"));
    expect(res.status).toBe(200);
    expect(resendInvitation).toHaveBeenCalledWith(
      "inv1",
      { id: "me", name: "Inviter" },
      { restrictToInviterId: "me" },
    );
  });

  it("surfaces the guard's 403 and does not mutate", async () => {
    forbiddenInviter();
    const res = await idAction(idReq("DELETE"));
    expect(res.status).toBe(403);
    expect(revokeInvitation).not.toHaveBeenCalled();
  });

  it("acting on another inviter's invitation reads as not-found (404)", async () => {
    asInviter("UNIT_ADMIN", "me");
    vi.mocked(revokeInvitation).mockResolvedValue({
      ok: false,
      status: 404,
      error: "NOT_FOUND",
    } as never);
    const res = await idAction(idReq("DELETE"));
    expect(res.status).toBe(404);
  });
});
