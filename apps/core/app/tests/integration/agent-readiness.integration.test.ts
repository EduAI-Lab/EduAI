/**
 * Automated agent-readiness checks (#672): JSON error envelope, email side-effects,
 * and manifest-driven coverage for admin write tools.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn().mockResolvedValue({ delivered: true }),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { sendEmail } from "~/lib/email/mailer.server";
import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { action as createInvitationAction } from "~/routes/api/invitations";
import {
  AGENT_READY_ENDPOINTS,
  agentReadyEmailEndpoints,
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
  it("manifest lists agent-ready endpoints with method and path", () => {
    expect(AGENT_READY_ENDPOINTS.length).toBeGreaterThanOrEqual(12);
    for (const entry of AGENT_READY_ENDPOINTS) {
      expect(entry.method).toMatch(/^(GET|POST|PATCH|DELETE)$/);
      expect(entry.path.startsWith("/api/")).toBe(true);
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

  it("email-sending agent route invokes the mailer", async () => {
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
          role: "INSTRUCTOR",
          authorizedUnits: ["COSC"],
        }),
      }),
      params: {},
      context: {} as never,
    });

    expect(res.status).toBe(201);
    expect(sendEmailMock).toHaveBeenCalled();
    const emailEntry = agentReadyEmailEndpoints().find((e) => e.path === "/api/invitations");
    expect(emailEntry?.sendsEmail).toBe(true);
  });
});
