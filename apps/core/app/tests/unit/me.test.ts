// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { loader, action } from "~/routes/api/me";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

const PROFILE = {
  id: "u1",
  email: "me@test.com",
  name: "Me",
  image: null,
  role: "STUDENT",
  isActive: true,
  emailVerified: true,
  authorizedUnits: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function makeArgs(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost/api/me", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params: {},
    context: {} as never,
  };
}

function mockUser(id = "u1", role = "STUDENT") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(PROFILE as never);
  vi.mocked(prisma.user.update).mockResolvedValue(PROFILE as never);
});

describe("GET /api/me (#297)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
  });

  it("returns the caller's own profile", async () => {
    mockUser("u1");
    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("u1");
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
  });
});

describe("PATCH /api/me (#297)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("PATCH", { name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("returns 405 for non-PATCH methods", async () => {
    const res = await action(makeArgs("POST", {}));
    expect(res.status).toBe(405);
  });

  it("updates name and image only", async () => {
    mockUser("u1");
    const res = await action(
      makeArgs("PATCH", { name: "New Name", image: "https://x.test/a.png" }),
    );
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { name: "New Name", image: "https://x.test/a.png" },
      }),
    );
  });

  it("rejects a role change attempt at the schema layer (whitelist)", async () => {
    mockUser("u1");
    const res = await action(makeArgs("PATCH", { name: "Sneaky", role: "ADMIN" }));
    // Unknown keys are stripped by zod — role never reaches the update.
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Sneaky" } }),
    );
  });

  it("rejects an invalid payload", async () => {
    mockUser("u1");
    const res = await action(makeArgs("PATCH", { name: "x" }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
