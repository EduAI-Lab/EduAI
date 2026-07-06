// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    userPreference: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/user-preferences.server", () => ({
  saveUserPreference: vi.fn(),
}));

import { loader, action } from "~/routes/api/preferences";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { saveUserPreference } from "~/lib/user-preferences.server";

function makeArgs(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost/api/preferences", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params: {},
    context: {} as never,
  } as any;
}

function mockUser(id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
  });

  it("returns defaults when no preference row exists", async () => {
    mockUser();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null);
    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assistDefault: false,
      lastCourseCode: null,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("returns the stored preferences", async () => {
    mockUser();
    vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
      assistDefault: true,
      lastCourseCode: "COSC 111",
      motionReduced: true,
      density: "compact",
      theme: "dark",
    } as never);
    const res = await loader(makeArgs());
    expect(await res.json()).toEqual({
      assistDefault: true,
      lastCourseCode: "COSC 111",
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });
    expect(prisma.userPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
  });
});

describe("PATCH /api/preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("PATCH", { assistDefault: true }));
    expect(res.status).toBe(401);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(405);
  });

  it("persists assistDefault and returns the saved values", async () => {
    mockUser();
    vi.mocked(saveUserPreference).mockResolvedValue({
      assistDefault: true,
      lastCourseCode: null,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
    const res = await action(makeArgs("PATCH", { assistDefault: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assistDefault: true,
      lastCourseCode: null,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
    expect(saveUserPreference).toHaveBeenCalledWith("u1", { assistDefault: true });
  });

  it("persists motion, density, and theme fields", async () => {
    mockUser();
    vi.mocked(saveUserPreference).mockResolvedValue({
      assistDefault: false,
      lastCourseCode: null,
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });
    const res = await action(
      makeArgs("PATCH", { motionReduced: true, density: "compact", theme: "dark" }),
    );
    expect(res.status).toBe(200);
    expect(saveUserPreference).toHaveBeenCalledWith("u1", {
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });
  });

  it("returns 400 when no valid fields are provided", async () => {
    mockUser();
    const res = await action(makeArgs("PATCH", { assistDefault: "yes", bogus: 1 }));
    expect(res.status).toBe(400);
    expect(saveUserPreference).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    mockUser();
    const res = await action({
      request: new Request("http://localhost/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      params: {},
      context: {} as never,
    } as any);
    expect(res.status).toBe(400);
  });
});
