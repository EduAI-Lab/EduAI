// @vitest-environment node
//
// AUTH-04: concurrent demotions of the last two active ADMINs must leave >= 1.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { auth } from "~/lib/auth/server";

const getSession = vi.mocked(auth.api.getSession);

const suffix = randomUUID().slice(0, 8);
let adminAId: string;
let adminBId: string;
let previouslyActiveOtherAdminIds: string[] = [];

beforeAll(async () => {
  const [adminA, adminB] = await Promise.all([
    prisma.user.create({
      data: {
        email: `admin-floor-a-${suffix}@test.local`,
        name: "Floor Admin A",
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
      },
    }),
    prisma.user.create({
      data: {
        email: `admin-floor-b-${suffix}@test.local`,
        name: "Floor Admin B",
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
      },
    }),
  ]);
  adminAId = adminA.id;
  adminBId = adminB.id;

  // Isolate the floor to these two admins for the race. Restore afterward.
  const others = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      isActive: true,
      id: { notIn: [adminAId, adminBId] },
    },
    select: { id: true },
  });
  previouslyActiveOtherAdminIds = others.map((u) => u.id);
  if (previouslyActiveOtherAdminIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: previouslyActiveOtherAdminIds } },
      data: { isActive: false },
    });
  }
});

afterAll(async () => {
  if (previouslyActiveOtherAdminIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: previouslyActiveOtherAdminIds } },
      data: { isActive: true },
    });
  }
  await prisma.user.deleteMany({
    where: { id: { in: [adminAId, adminBId] } },
  });
});

beforeEach(() => {
  getSession.mockImplementation((async (ctx: { headers?: Headers } | undefined) => {
    const cookie = ctx?.headers?.get("cookie") ?? "";
    if (cookie.includes("session=admin-b")) {
      return {
        user: {
          id: adminBId,
          role: "ADMIN",
          name: "Floor Admin B",
          email: `admin-floor-b-${suffix}@test.local`,
        },
      };
    }
    return {
      user: {
        id: adminAId,
        role: "ADMIN",
        name: "Floor Admin A",
        email: `admin-floor-a-${suffix}@test.local`,
      },
    };
  }) as never);
});

function patchUser(actorCookie: string, userId: string, body: Record<string, unknown>) {
  return handleUsersApiRequest(
    new Request(`http://localhost/api/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: actorCookie,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("PATCH /api/users/:id — admin-floor concurrency (AUTH-04)", () => {
  it("serializes crossed demotions of the last two ADMINs so one remains", async () => {
    await prisma.user.updateMany({
      where: { id: { in: [adminAId, adminBId] } },
      data: { isActive: true, role: "ADMIN" },
    });

    const activeBefore = await prisma.user.count({
      where: { role: "ADMIN", isActive: true },
    });
    expect(activeBefore).toBe(2);

    // A demotes B while B demotes A — without the advisory lock both can pass
    // the floor check under READ COMMITTED and leave zero admins.
    const [resA, resB] = await Promise.all([
      patchUser("session=admin-a", adminBId, { isActive: false }),
      patchUser("session=admin-b", adminAId, { isActive: false }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(
      [await resA.json(), await resB.json()].some(
        (body) => body.error === "ADMIN_FLOOR_VIOLATION",
      ),
    ).toBe(true);

    const remaining = await prisma.user.count({
      where: { role: "ADMIN", isActive: true },
    });
    expect(remaining).toBe(1);
  });
});
