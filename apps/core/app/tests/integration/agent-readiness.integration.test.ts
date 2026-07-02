/**
 * Automated agent-readiness checks (#672): JSON error envelope, email side-effects,
 * and manifest-driven coverage for all Core APIs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn().mockResolvedValue({ delivered: true }),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
  authBaseURL: "http://localhost:5173",
}));

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { sendEmail } from "~/lib/email/mailer.server";
import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { action as createInvitationAction } from "~/routes/api/invitations";
import {
  CORE_API_ENDPOINTS,
  agentReadyEmailEndpoints,
  agentReadyEndpoints,
  readinessSummary,
} from "~/lib/agent-readiness/manifest";
import { seedUser } from "../helpers/rbac";

const getSession = vi.mocked(auth.api.getSession);
const sendEmailMock = vi.mocked(sendEmail);

let adminId = "";

beforeAll(async () => {
  const admin = await seedUser({ role: "ADMIN", name: "Agent Ready Admin" });
  adminId = admin.id;
});

afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({ where: { route: "POST /api/users" } });
  await prisma.invitation.deleteMany({ where: { invitedById: adminId } });
  await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
});

describe("agent-readiness integration (#672)", () => {
  it("manifest inventories every Core API with readiness status", () => {
    expect(CORE_API_ENDPOINTS.length).toBeGreaterThanOrEqual(80);
    const summary = readinessSummary();
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.partial).toBe(0);
    expect(summary.excluded).toBeGreaterThan(0);
    for (const entry of CORE_API_ENDPOINTS) {
      expect(entry.readiness).toMatch(/^(ready|partial|excluded)$/);
      expect(entry.path.startsWith("/api/")).toBe(true);
    }
  });

  it("ready endpoints are a strict subset of the full inventory", () => {
    const readyIds = new Set(agentReadyEndpoints().map((e) => `${e.method} ${e.path}`));
    for (const id of readyIds) {
      const found = CORE_API_ENDPOINTS.find((e) => `${e.method} ${e.path}` === id);
      expect(found?.readiness).toBe("ready");
    }
  });

  it("POST /api/users returns MCP-ready error envelope on forbidden access", async () => {
    getSession.mockResolvedValue(null as never);
    const res = await handleUsersApiRequest(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@y.z", name: "X", role: "STUDENT" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("email-sending routes invoke the mailer", async () => {
    getSession.mockResolvedValue({
      user: { id: adminId, role: "ADMIN", name: "Agent Ready Admin" },
    } as never);
    sendEmailMock.mockClear();

    const email = `agent-ready-${randomUUID().slice(0, 8)}@test.local`;
    const res = await createInvitationAction({
      request: new Request("http://localhost/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: "Invite Test",
          role: "INSTRUCTOR",
        }),
      }),
      params: {},
      context: {} as never,
    });

    expect(res.status).toBe(201);
    expect(sendEmailMock).toHaveBeenCalled();
    const emailEntries = agentReadyEmailEndpoints();
    expect(emailEntries.some((e) => e.path === "/api/invitations")).toBe(true);
  });
});
