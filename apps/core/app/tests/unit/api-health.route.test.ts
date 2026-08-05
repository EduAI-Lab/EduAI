// @vitest-environment node
// #1213 — GET /api/health: unauthenticated liveness probe.
import { describe, it, expect } from "vitest";
import { loader } from "~/routes/api/health";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await loader();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
