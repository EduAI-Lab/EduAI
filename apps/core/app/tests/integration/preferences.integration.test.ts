// @vitest-environment node
//
// Assistive Mode preference round-trip against the real test DB:
// PATCH /api/preferences persists → GET reads back → the root loader
// (which gates data-assistive on <html>) reflects the stored value.

import { describe, it, expect, vi, afterAll } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader, action } from "~/routes/api/preferences";
import { loader as rootLoader } from "~/root";
import { seedUser, mockSession, cleanupRbac } from "../helpers/rbac";

const createdUserIds: string[] = [];

afterAll(async () => {
  await prisma.userPreference.deleteMany({ where: { userId: { in: createdUserIds } } });
  await cleanupRbac({ userIds: createdUserIds });
  await prisma.$disconnect();
});

function getArgs(path = "/api/preferences") {
  return {
    request: new Request(`http://localhost${path}`),
    params: {},
    context: {} as never,
  };
}

function patchArgs(body: unknown) {
  return {
    request: new Request("http://localhost/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  };
}

describe("Assistive preference round-trip", () => {
  it("defaults to OFF for a user with no preference row", async () => {
    const user = await seedUser();
    createdUserIds.push(user.id);
    mockSession(user);

    const res = await loader(getArgs());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assistDefault: false,
      lastCourseCode: null,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });

    const root = await rootLoader(getArgs("/"));
    expect(root).toEqual({
      assistive: false,
      canInvite: false,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("PATCH ON persists, survives re-read, and flips the root loader", async () => {
    const user = await seedUser();
    createdUserIds.push(user.id);
    mockSession(user);

    const patched = await action(patchArgs({ assistDefault: true }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).assistDefault).toBe(true);

    // Real row in the DB
    const row = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(row?.assistDefault).toBe(true);

    // GET reads it back; root loader now reports ON
    const res = await loader(getArgs());
    expect((await res.json()).assistDefault).toBe(true);
    expect(await rootLoader(getArgs("/"))).toEqual({
      assistive: true,
      canInvite: false,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("PATCH OFF returns the account to baseline", async () => {
    const user = await seedUser();
    createdUserIds.push(user.id);
    mockSession(user);

    await action(patchArgs({ assistDefault: true }));
    await action(patchArgs({ assistDefault: false }));

    const row = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(row?.assistDefault).toBe(false);
    expect(await rootLoader(getArgs("/"))).toEqual({
      assistive: false,
      canInvite: false,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("preference is per-account: one user's toggle does not leak to another", async () => {
    const userOn = await seedUser();
    const userOff = await seedUser();
    createdUserIds.push(userOn.id, userOff.id);

    mockSession(userOn);
    await action(patchArgs({ assistDefault: true }));

    mockSession(userOff);
    const res = await loader(getArgs());
    expect((await res.json()).assistDefault).toBe(false);
    expect(await rootLoader(getArgs("/"))).toEqual({
      assistive: false,
      canInvite: false,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("guests always get baseline from the root loader", async () => {
    mockSession(null);
    expect(await rootLoader(getArgs("/"))).toEqual({
      assistive: false,
      canInvite: false,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });

    const res = await loader(getArgs());
    expect(res.status).toBe(401);
  });

  it("does not clobber lastCourseCode when only assistDefault is updated", async () => {
    const user = await seedUser();
    createdUserIds.push(user.id);
    mockSession(user);

    await action(patchArgs({ lastCourseCode: "COSC 111" }));
    await action(patchArgs({ assistDefault: true }));

    const res = await loader(getArgs());
    expect(await res.json()).toEqual({
      assistDefault: true,
      lastCourseCode: "COSC 111",
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("persists motion, density, and theme through GET and the root loader", async () => {
    const user = await seedUser();
    createdUserIds.push(user.id);
    mockSession(user);

    const patched = await action(
      patchArgs({ motionReduced: true, density: "compact", theme: "dark" }),
    );
    expect(patched.status).toBe(200);

    const row = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(row?.motionReduced).toBe(true);
    expect(row?.density).toBe("compact");
    expect(row?.theme).toBe("dark");

    expect(await rootLoader(getArgs("/"))).toEqual({
      assistive: false,
      canInvite: false,
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });
  });
});
