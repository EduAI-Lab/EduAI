// @vitest-environment node
// #1459 — POST /api/e2e/seed: E2E-only test helper that runs prisma/seed.ts's
// main(), gated behind NODE_ENV=test + E2E_SEED_SECRET (invisible otherwise),
// mirroring /api/e2e/promote's guard pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runSeed = vi.fn();
vi.mock("../../../prisma/seed", () => ({
  main: (...args: unknown[]) => runSeed(...args),
}));

import { action } from "~/routes/api/e2e.seed";

function makeArgs(method: string, body?: unknown) {
  return {
    request: new Request("http://localhost/api/e2e/seed", {
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

describe("POST /api/e2e/seed", () => {
  it("returns 404 when NODE_ENV is not test", async () => {
    process.env.NODE_ENV = "production";
    const res = await action(makeArgs("POST", { secret: "shhh" }));
    expect(res.status).toBe(404);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it("returns 404 when E2E_SEED_SECRET is unset", async () => {
    delete process.env.E2E_SEED_SECRET;
    const res = await action(makeArgs("POST", { secret: "shhh" }));
    expect(res.status).toBe(404);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeArgs("GET"));
    expect(res.status).toBe(405);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it("returns 403 when the secret does not match", async () => {
    const res = await action(makeArgs("POST", { secret: "wrong" }));
    expect(res.status).toBe(403);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it("returns 500 with the error message when seeding throws", async () => {
    runSeed.mockRejectedValue(new Error("db unreachable"));
    const res = await action(makeArgs("POST", { secret: "shhh" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "SEED_FAILED", message: "db unreachable" });
  });

  it("runs the seed and returns 200 on success", async () => {
    runSeed.mockResolvedValue(undefined);
    const res = await action(makeArgs("POST", { secret: "shhh" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(runSeed).toHaveBeenCalledTimes(1);
  });
});
