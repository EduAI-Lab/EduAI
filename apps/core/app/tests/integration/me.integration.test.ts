// @vitest-environment node
//
// #297 — GET/PATCH /api/me round-trip per role against the real test DB.

import { describe, it, expect, vi, afterAll } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader, action } from "~/routes/api/me";
import { seedUser, mockSession, cleanupRbac } from "../helpers/rbac";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupRbac({ userIds: createdUserIds });
  await prisma.$disconnect();
});

function getArgs() {
  return {
    request: new Request("http://localhost/api/me"),
    params: {},
    context: {} as never,
  };
}

function patchArgs(body: unknown) {
  return {
    request: new Request("http://localhost/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  };
}

describe("GET/PATCH /api/me round-trip (#297)", () => {
  it.each(["STUDENT", "INSTRUCTOR", "UNIT_ADMIN", "ADMIN"] as const)(
    "%s can read and edit their own profile",
    async (role) => {
      const user = await seedUser({
        role,
        authorizedUnits: role === "UNIT_ADMIN" ? ["COSC"] : [],
      });
      createdUserIds.push(user.id);

      // GET
      mockSession(user);
      const got = await loader(getArgs());
      expect(got.status).toBe(200);
      const profile = await got.json();
      expect(profile.id).toBe(user.id);
      expect(profile.role).toBe(role);

      // PATCH name + image
      mockSession(user);
      const patched = await action(
        patchArgs({ name: `Renamed ${role}`, image: "https://example.test/avatar.png" }),
      );
      expect(patched.status).toBe(200);
      const updated = await patched.json();
      expect(updated.name).toBe(`Renamed ${role}`);
      expect(updated.image).toBe("https://example.test/avatar.png");

      // Role untouched in the DB
      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.role).toBe(role);
      expect(row?.name).toBe(`Renamed ${role}`);
    },
  );

  it("anonymous caller gets 401", async () => {
    mockSession(null);
    const res = await loader(getArgs());
    expect(res.status).toBe(401);
  });
});
