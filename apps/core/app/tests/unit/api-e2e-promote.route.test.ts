// @vitest-environment node
// #1213 — POST /api/e2e/promote: E2E-only test helper, gated behind
// NODE_ENV=test + E2E_SEED_SECRET, invisible (404) otherwise.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { action } from "~/routes/api/e2e.promote";
import prisma from "~/lib/prisma.server";

function makeArgs(method: string, body?: unknown) {
  return {
    request: new Request("http://localhost/api/e2e/promote", {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params: {},
    context: {} as never,
  } as never;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  process.env.E2E_SEED_SECRET = "shhh";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/e2e/promote", () => {
  it("returns 404 when NODE_ENV is not test", async () => {
    process.env.NODE_ENV = "production";
    const res = await action(makeArgs("POST", { secret: "shhh", email: "a@ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when E2E_SEED_SECRET is unset", async () => {
    delete process.env.E2E_SEED_SECRET;
    const res = await action(makeArgs("POST", { secret: "shhh", email: "a@ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(404);
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeArgs("GET"));
    expect(res.status).toBe(405);
  });

  it("returns 403 when the secret does not match", async () => {
    const res = await action(makeArgs("POST", { secret: "wrong", email: "a@ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when email or role is missing", async () => {
    const res = await action(makeArgs("POST", { secret: "shhh" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid role", async () => {
    const res = await action(
      makeArgs("POST", { secret: "shhh", email: "a@ubc.ca", role: "NOT_A_ROLE" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await action(
      makeArgs("POST", { secret: "shhh", email: "missing@ubc.ca", role: "ADMIN" }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("promotes the user and returns the updated record", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", email: "a@ubc.ca" } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "u1",
      email: "a@ubc.ca",
      role: "ADMIN",
      name: "A",
    } as never);

    const res = await action(makeArgs("POST", { secret: "shhh", email: "a@ubc.ca", role: "ADMIN" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "u1", email: "a@ubc.ca", role: "ADMIN", name: "A" });
  });
});
