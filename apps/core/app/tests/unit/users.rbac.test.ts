// @vitest-environment node
//
// #297 — PATCH /api/users/:id guards: self-role-change lockout and
// authorizedUnits assignment rules (§4).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    enrollment: { count: vi.fn() },
  },
}));

// §541: authorizedUnits codes are validated against the Discipline table.
vi.mock("~/lib/disciplines/server", () => {
  const KNOWN = ["COSC", "MATH", "STAT", "DATA", "PHYS"];
  return {
    areValidDisciplineCodes: vi.fn(async (codes: string[]) => codes.every((c) => KNOWN.includes(c))),
    isValidDisciplineCode: vi.fn(async (code: string) => KNOWN.includes(code)),
  };
});

import { action } from "~/routes/api/users.$";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };

function makePatch(userId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { "*": userId },
    context: {} as never,
  };
}

function mockUser(user: { id: string; role: string } | null) {
  vi.mocked(auth.api.getSession).mockResolvedValue((user ? { user } : null) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser(ADMIN);
  vi.mocked(prisma.user.update).mockResolvedValue({
    id: "target",
    _count: { enrollments: 0, courseTAs: 0, taughtCourses: 0, aiInteractions: 0 },
  } as never);
  vi.mocked(prisma.enrollment.count).mockResolvedValue(0);
});

describe("PATCH /api/users/:id — self guards (#297)", () => {
  it("rejects a non-admin caller with 403", async () => {
    mockUser({ id: "u1", role: "INSTRUCTOR" });
    const res = await action(makePatch("u2", { role: "TA" }));
    expect(res.status).toBe(403);
  });

  it("rejects self-role-change with 403", async () => {
    const res = await action(makePatch("admin-1", { role: "STUDENT" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cannot change your own role" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows a self-PATCH that does not change the role", async () => {
    const res = await action(makePatch("admin-1", { name: "Renamed Admin" }));
    expect(res.status).toBe(200);
  });

  it("still rejects self-deactivation with 400 (existing guard)", async () => {
    const res = await action(makePatch("admin-1", { isActive: false }));
    expect(res.status).toBe(400);
  });

  it("allows an admin role-change on ANOTHER user", async () => {
    const res = await action(makePatch("other-user", { role: "INSTRUCTOR" }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-user" },
        data: { role: "INSTRUCTOR" },
      }),
    );
  });
});

describe("PATCH /api/users/:id — authorizedUnits assignment (#297)", () => {
  it("accepts valid units on a UNIT_ADMIN target", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "UNIT_ADMIN" } as never);
    const res = await action(makePatch("ua-1", { authorizedUnits: ["COSC", "MATH"] }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { authorizedUnits: ["COSC", "MATH"] },
      }),
    );
  });

  it("rejects an invalid subject code with 400 (§541 Discipline check)", async () => {
    const res = await action(makePatch("ua-1", { authorizedUnits: ["cosc"] }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a non-UNIT_ADMIN target with 422 ROLE_MISMATCH", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "INSTRUCTOR" } as never);
    const res = await action(makePatch("instr-1", { authorizedUnits: ["COSC"] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ROLE_MISMATCH" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("accepts units when the same request promotes the target to UNIT_ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    const res = await action(
      makePatch("u-promote", { role: "UNIT_ADMIN", authorizedUnits: ["COSC"] }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when the target user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await action(makePatch("ghost", { authorizedUnits: ["COSC"] }));
    expect(res.status).toBe(404);
  });
});
