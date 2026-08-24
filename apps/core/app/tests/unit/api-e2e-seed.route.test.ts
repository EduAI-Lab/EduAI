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
import type { JsonValue } from "~/lib/json-value";

function makeArgs(method: string, body?: JsonValue) {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return {
    request: new Request("http://localhost/api/e2e/seed", init),
    params: {},
    context: {} as never,
  } as never;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  process.env.E2E_SEED_SECRET = "shhh";
  delete process.env.EDUAI_LOCAL_SEED_PASSWORD;
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
    expect(runSeed).toHaveBeenCalledWith({ seedPassword: "EduAI2026!" });
  });

  it("serializes concurrent seed calls so runSeed does not overlap", async () => {
    let running = 0;
    let maxRunning = 0;
    runSeed.mockImplementation(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 40));
      running -= 1;
    });

    const [first, second] = await Promise.all([
      action(makeArgs("POST", { secret: "shhh" })),
      action(makeArgs("POST", { secret: "shhh" })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(runSeed).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });
});
